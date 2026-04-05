"""
Bot runner — background execution of bot runs.

Handles the full lifecycle:
1. Build BotInput
2. Call OpenAI Responses API (background mode)
3. Poll until completion
4. Parse output → create Annotation + Chunk DB objects
5. Update AgentRun status throughout
"""

from __future__ import annotations

import logging
import threading
import time

from django.conf import settings
from django.utils import timezone

from annotations.models import Annotation
from documents.models import Block, Document

from .bot_contract import BotConfig, BotOutput
from .context_builder import build_bot_input
from .global_annotator import (
    build_system_prompt,
    build_user_prompt,
    call_openai,
    parse_bot_output,
)
from .models import AgentRun, Chunk

logger = logging.getLogger(__name__)

# Polling configuration
OPENAI_POLL_INTERVAL = 10  # seconds
OPENAI_POLL_TIMEOUT = 70 * 60  # 70 minutes


def launch_bot_run(run: AgentRun) -> None:
    """Launch a bot run in a background thread."""
    thread = threading.Thread(
        target=_execute_bot_run,
        args=(run.id,),
        daemon=True,
        name=f"bot-run-{run.id}",
    )
    thread.start()


def _execute_bot_run(run_id) -> None:
    """Execute a bot run end-to-end. Runs in a background thread."""
    try:
        run = AgentRun.objects.get(pk=run_id)
    except AgentRun.DoesNotExist:
        logger.error("AgentRun %s not found", run_id)
        return

    try:
        # Mark as running
        run.status = "running"
        run.started_at = timezone.now()
        run.save(update_fields=["status", "started_at"])

        document = run.document

        # Update document agent_status
        document.agent_status = "running"
        document.save(update_fields=["agent_status"])

        # Build bot input
        config = _build_config(run)
        block_ids = run.config.get("block_ids")  # optional scope restriction
        bot_input = build_bot_input(document, config, block_ids=block_ids)

        # Build prompts
        produce_checks = config.options.get("produce_checks", False)
        system_prompt = build_system_prompt(produce_checks=produce_checks)
        user_prompt = build_user_prompt(bot_input)

        # Get API key
        api_key = settings.OPENAI_API_KEY
        if not api_key:
            raise ValueError("OPENAI_API_KEY not configured")

        # Always use background mode so every run is cancellable via
        # the OpenAI API (synchronous calls block the thread and can't
        # be cancelled until the model finishes).
        client, response = call_openai(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=config.model,
            reasoning_effort=config.reasoning_effort,
            api_key=api_key,
            background=True,
        )

        # Store response ID for cancellation support
        run.openai_response_id = response.id
        run.save(update_fields=["openai_response_id"])

        # Poll until done
        response = _poll_until_done(client, response, run)

        # Check if the run was cancelled while we were polling
        run.refresh_from_db()
        if run.status == "failed":
            logger.info("Bot run %s was cancelled, aborting", run_id)
            return

        # Extract output
        raw_text = response.output_text
        run.raw_output = {"output_text": raw_text, "openai_response_id": response.id}

        # Token tracking
        if hasattr(response, "usage") and response.usage:
            run.input_tokens = getattr(response.usage, "input_tokens", None)
            run.output_tokens = getattr(response.usage, "output_tokens", None)
        run.save(update_fields=["raw_output", "input_tokens", "output_tokens"])

        # Parse and store results
        valid_block_ids = set(
            Block.objects.filter(document=document).values_list("block_id", flat=True)
        )
        bot_output = parse_bot_output(raw_text, valid_block_ids)
        _store_results(run, document, bot_output)

        # Mark completed
        run.status = "completed"
        run.completed_at = timezone.now()
        run.save(update_fields=["status", "completed_at"])

        document.agent_status = "completed"
        document.save(update_fields=["agent_status"])

        logger.info(
            "Bot run %s completed: %d chunks, %d annotations",
            run_id,
            len(bot_output.chunks),
            len(bot_output.annotations),
        )

    except Exception as e:
        logger.exception("Bot run %s failed", run_id)
        try:
            run.refresh_from_db()
            run.status = "failed"
            run.error_message = str(e)
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "error_message", "completed_at"])

            run.document.agent_status = "failed"
            run.document.save(update_fields=["agent_status"])
        except Exception:
            logger.exception("Failed to update run status after error")


def cancel_bot_run(run: AgentRun) -> None:
    """Cancel a running bot. Idempotent."""
    if run.openai_response_id:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=settings.OPENAI_API_KEY)
            client.responses.cancel(run.openai_response_id)
        except Exception:
            logger.exception("Failed to cancel OpenAI response %s", run.openai_response_id)

    run.status = "failed"
    run.error_message = "Cancelled by user"
    run.completed_at = timezone.now()
    run.save(update_fields=["status", "error_message", "completed_at"])

    run.document.agent_status = "idle"
    run.document.save(update_fields=["agent_status"])


def _build_config(run: AgentRun) -> BotConfig:
    """Build a BotConfig from an AgentRun's stored config."""
    cfg = run.config or {}
    return BotConfig(
        model=run.model,
        reasoning_effort=cfg.get("reasoning_effort", settings.DEFAULT_REASONING_EFFORT),
        preset=run.preset,
        steering_prompt=cfg.get("steering_prompt", ""),
        options=cfg.get("options", {}),
    )


def _poll_until_done(client, response, run: AgentRun):
    """Poll OpenAI until the response reaches a terminal state."""
    start = time.monotonic()

    while response.status in ("queued", "in_progress"):
        elapsed = time.monotonic() - start
        if elapsed > OPENAI_POLL_TIMEOUT:
            raise TimeoutError(
                f"OpenAI response timed out after {OPENAI_POLL_TIMEOUT // 60} minutes"
            )

        time.sleep(OPENAI_POLL_INTERVAL)

        try:
            response = client.responses.retrieve(response.id)
        except Exception as e:
            # Retry transient errors up to 3 times
            logger.warning("Poll error (will retry): %s", e)
            for attempt in range(3):
                time.sleep(OPENAI_POLL_INTERVAL)
                try:
                    response = client.responses.retrieve(response.id)
                    break
                except Exception:
                    if attempt == 2:
                        raise

        # Update run with elapsed time for frontend display
        run.raw_output = run.raw_output or {}
        run.raw_output["elapsed_seconds"] = int(time.monotonic() - start)
        run.raw_output["openai_status"] = response.status
        run.save(update_fields=["raw_output"])

    if response.status == "failed":
        error = getattr(response, "error", None)
        raise RuntimeError(f"OpenAI response failed: {error}")

    if response.status == "cancelled":
        raise RuntimeError("OpenAI response was cancelled")

    return response


def _store_results(
    run: AgentRun,
    document: Document,
    bot_output: BotOutput,
) -> None:
    """Create Chunk and Annotation objects from parsed BotOutput."""
    # Store summary on the run
    run.raw_output = run.raw_output or {}
    run.raw_output["summary"] = bot_output.summary
    run.raw_output["overall_confidence"] = bot_output.overall_confidence
    run.save(update_fields=["raw_output"])

    # Create Chunks
    chunk_map: dict[str, Chunk] = {}
    for i, c in enumerate(bot_output.chunks):
        chunk = Chunk.objects.create(
            agent_run=run,
            document=document,
            chunk_id=c.chunk_id,
            source_block_ids=c.source_ids,
            summary=c.summary,
            confidence=c.confidence,
            order=i,
        )
        chunk_map[c.chunk_id] = chunk

    # Create Annotations
    for ann in bot_output.annotations:
        chunk = chunk_map.get(ann.chunk_id)
        Annotation.objects.create(
            document=document,
            start_block=ann.start_block,
            end_block=ann.end_block,
            source="agent",
            author="GlobalAnnotatorBot",
            agent_run=run,
            chunk=chunk,
            confidence=ann.confidence,
            category=ann.category,
            tags=ann.tags,
            severity=ann.severity,
            body=ann.body,
        )
