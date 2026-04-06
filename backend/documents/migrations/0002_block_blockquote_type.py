# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="block",
            name="block_type",
            field=models.CharField(
                choices=[
                    ("paragraph", "Paragraph"),
                    ("theorem", "Theorem"),
                    ("lemma", "Lemma"),
                    ("proposition", "Proposition"),
                    ("corollary", "Corollary"),
                    ("definition", "Definition"),
                    ("remark", "Remark"),
                    ("proof", "Proof"),
                    ("equation", "Display Equation"),
                    ("figure", "Figure"),
                    ("section_heading", "Section Heading"),
                    ("list", "List"),
                    ("raw_latex", "Raw LaTeX (TikZ etc.)"),
                    ("blockquote", "Blockquote"),
                ],
                max_length=30,
            ),
        ),
    ]
