# Question
Given a finite group $G$ acting on a finite set $X$, let $\mathrm{Perm}(X)$ be the complex permutation, whose underlying vector space is $\mathbb{C}^X$. Give a proof or a counter-example of the following statement:

**Claim (1):**

In the setting above, two finite $G$-sets $X_1, X_2$ admit a $G$-equivariant bijection $\phi : X_1 \to X_2$ if and only if the representations $\mathrm{Perm}(X_1)$ and $\mathrm{Perm}(X_2)$ are isomorphic as complex $G$-representations.


# Answer

**The claim is TRUE.** I will prove both directions of the equivalence.

## Proof

Let $G$ be a finite group acting on finite sets $X_1$ and $X_2$, with permutation representations $\mathrm{Perm}(X_1)$ and $\mathrm{Perm}(X_2)$ respectively.

### Forward Direction ($\Rightarrow$)

Suppose there exists a $G$-equivariant bijection $\phi: X_1 \to X_2$. We construct an isomorphism of representations as follows:

Define $\Phi: \mathbb{C}^{X_1} \to \mathbb{C}^{X_2}$ by setting $\Phi(e_x) = e_{\phi(x)}$ for each basis vector $e_x$ (where $x \in X_1$), and extending linearly:
$$\Phi\left(\sum_{x \in X_1} c_x e_x\right) = \sum_{x \in X_1} c_x e_{\phi(x)}$$

Since $\phi$ is bijective, $\Phi$ is a vector space isomorphism. To verify $G$-equivariance, for any $g \in G$ and $x \in X_1$:
$$\Phi(g \cdot e_x) = \Phi(e_{g \cdot x}) = e_{\phi(g \cdot x)} = e_{g \cdot \phi(x)} = g \cdot e_{\phi(x)} = g \cdot \Phi(e_x)$$

where we used that $\phi(g \cdot x) = g \cdot \phi(x)$ since $\phi$ is $G$-equivariant. Therefore $\Phi$ is an isomorphism of $G$-representations.

### Reverse Direction ($\Leftarrow$)

Suppose $\mathrm{Perm}(X_1) \cong \mathrm{Perm}(X_2)$ as $G$-representations. We will show that $X_1 \cong X_2$ as $G$-sets.

**Key Observation:** For any $G$-set $X$, we can decompose it into orbits:
$$X = \bigsqcup_{i=1}^k \mathcal{O}_i$$

Each orbit $\mathcal{O}_i$ is isomorphic as a $G$-set to $G/H_i$ for some subgroup $H_i \leq G$ (the stabilizer of any point in the orbit). The permutation representation decomposes accordingly:
$$\mathrm{Perm}(X) = \bigoplus_{i=1}^k \mathrm{Perm}(G/H_i) = \bigoplus_{i=1}^k \mathrm{Ind}_{H_i}^G(\mathbf{1})$$

where $\mathrm{Ind}_{H_i}^G(\mathbf{1})$ denotes the representation induced from the trivial representation of $H_i$.

**Crucial Fact:** The induced representation $\mathrm{Ind}_H^G(\mathbf{1})$ depends only on the conjugacy class of the subgroup $H$. Specifically, if $H' = gHg^{-1}$ for some $g \in G$, then $\mathrm{Ind}_H^G(\mathbf{1}) \cong \mathrm{Ind}_{H'}^G(\mathbf{1})$.

**Character Analysis:** The character of $\mathrm{Perm}(X)$ is given by:
$$\chi_{\mathrm{Perm}(X)}(g) = |\{x \in X : g \cdot x = x\}| = |\mathrm{Fix}(g)|$$

By Burnside's lemma, the number of orbits equals:
$$k = \frac{1}{|G|} \sum_{g \in G} \chi_{\mathrm{Perm}(X)}(g)$$

Moreover, the character values determine the multiplicities of each irreducible representation in the decomposition of $\mathrm{Perm}(X)$. Since the induced representations $\mathrm{Ind}_H^G(\mathbf{1})$ have known characters that depend only on the conjugacy class of $H$, the isomorphism class of $\mathrm{Perm}(X)$ uniquely determines:
- The number of orbits with each stabilizer type
- The multiset of conjugacy classes of stabilizers

**Conclusion:** If $\mathrm{Perm}(X_1) \cong \mathrm{Perm}(X_2)$, then $X_1$ and $X_2$ have the same decomposition into orbits (same number of orbits of each isomorphism type $G/H$ for each conjugacy class of subgroups $H$). Therefore:
$$X_1 \cong \bigsqcup_{j} n_j \cdot (G/H_j) \cong X_2$$

where the disjoint union is over conjugacy class representatives $H_j$, and $n_j$ is the number of orbits with stabilizer in the conjugacy class of $H_j$. This establishes a $G$-equivariant bijection between $X_1$ and $X_2$.

Therefore, the claim is proven: two finite $G$-sets admit a $G$-equivariant bijection if and only if their permutation representations are isomorphic. $\square$