# Question

Let $g,n \in \mathbb{Z}_{\geq 0}$ with $2g-2+n>0$, and let

$$
E(g,n) = \left\{ \textbf{e} = (e_1, \ldots, e_n) \in \mathbb{Z}_{\geq 0}^n : |\textbf{e}| :=\sum_{j=1}^n e_j = 3g-3+n \right\}\,.
$$

An element $\textbf{e} \in E(g,n)$ is called *balanced* if $|e_i - e_j| \leq 1$ for $1 \leq i,j \leq n$.

For $\textbf{e} \in E(g,n)$, consider the descendant integral

$$
D(\textbf{e}) = \int_{\overline{\mathcal{M}}_{g,n}} \psi_1^{e_1} \psi_2^{e_2} \cdots \psi_n^{e_n}\,.
$$

Prove or give a counter-example to the following claim:

> The function $D : E(g,n) \to \mathbb{Q}, \textbf{e} \mapsto D(\textbf{e})$ achieves its maximum on a balanced vector $\textbf{e} \in E(g,n)$.

# Solution

The dimension of the moduli stack is
\[ d:=\dim\overline{\mathcal M}_{g,n}=3g-3+n,\qquad 2g-2+n>0. \]
For a multi–index \(\mathbf e=(e_1,\ldots,e_n)\in\Bbb Z_{\ge 0}^n\) with \(|\mathbf e|=d\), write
\[
D(\mathbf e)=\int_{\overline{\mathcal M}_{g,n}}\psi_1^{e_1}\cdots\psi_n^{e_n}.
\]
We prove that among all \(\mathbf e\) with fixed sum, \(D(\mathbf e)\) attains its maximum at a balanced vector, i.e. when the entries differ by at most 1.

## Step 1 (Two–point slice and its basic properties). 

Fix distinct indices \(i\neq j\) and set
\[ M:=\prod_{k\ne i,j}\psi_k^{e_k},\qquad q:=e_i+e_j. \]
For \(t=0,1,\dots,q\) consider the one–variable sequence
\[
S_t\;:=\;\int_{\overline{\mathcal M}_{g,n}}\psi_i^{\,t}\,\psi_j^{\,q-t}\,M.
\]
By the natural action of the symmetric group permuting the markings on \(\overline{\mathcal M}_{g,n}\), the classes \(\psi_i\) and \(\psi_j\) are exchanged by an automorphism that leaves \(M\) invariant; hence
\[
S_t=S_{q-t}\qquad(\text{palindromicity}).
\]

## Step 2 (Khovanskii–Teissier log–concavity). 

It is standard that each \(\psi_i\) is nef on \(\overline{\mathcal M}_{g,n}\). For nef classes \(A,B\) and fixed nef classes \(H_3,\dots,H_d\) on a projective (orbifold) variety of dimension \(d\), the Khovanskii–Teissier inequalities (equivalently, the mixed Hodge–Riemann bilinear relations) give the discrete log–concavity
\[
\big(\,\int A^t B^{q-t} H_3\cdots H_d\,\big)^2\;\ge\;\big(\,\int A^{t-1}B^{q-t+1} H_3\cdots H_d\,\big)\big(\,\int A^{t+1}B^{q-t-1} H_3\cdots H_d\,\big)
\]
for all \(1\le t\le q-1\). Applying this with \(A=\psi_i\), \(B=\psi_j\), \(H_3\cdots H_d=M\), we obtain
\[
S_t^2\ge S_{t-1}S_{t+1}\qquad(1\le t\le q-1)\qquad\text{(log–concavity).}
\]

## Step 3 (Monotonicity towards the middle). 

For a positive log–concave sequence, the ratios \(R_t:=S_{t+1}/S_t\) are weakly decreasing in \(t\). Using palindromicity,
\[ R_{q-t-1}=\frac{S_{q-t}}{S_{q-t-1}}=\frac{S_t}{S_{t+1}}=\frac{1}{R_t}. \]
Hence for \(t\le\lfloor q/2\rfloor-1\) we have \(R_t\ge R_{q-t-1}=1/R_t\), so \(R_t\ge 1\), i.e.
\[
S_{t+1}\ge S_t\quad\text{for }t<\frac q2,\qquad S_{t-1}\ge S_t\quad\text{for }t>\frac q2.
\]
In words: along the two–point slice \(\{(t,q-t):0\le t\le q\}\), the values increase up to the middle and then decrease.

## Step 4 (The balancing step). 

Suppose \(e_i\ge e_j+2\). Then \(e_i>q/2\). By the monotonicity just proved,
\[
D(e_1,\dots,e_i,\dots,e_j,\dots,e_n)=S_{e_i}\ \le\ S_{e_i-1}
\ =\ D(e_1,\dots,e_i-1,\dots,e_j+1,\dots,e_n).
\]
Thus, whenever two entries differ by at least 2, transferring one unit from the larger to the smaller weakly increases the value of the integral.

## Step 5 (Conclusion by iteration). 

Starting from any \(\mathbf e\in E(g,n)\), repeatedly apply the balancing step to any pair \((i,j)\) with \(|e_i-e_j|\ge 2\). This process terminates at a balanced vector \(\mathbf e^{\,\ast}\) (all entries differ by at most 1), and along the way the value of \(D\) never decreases. Hence
\[
D(\mathbf e)\le D(\mathbf e^{\,\ast})\quad\text{for some balanced }\mathbf e^{\,\ast}\in E(g,n).
\]
In particular, the maximum of \(D\) on \(E(g,n)\) is achieved at a balanced vector. (Uniqueness need not hold: plateaus can occur.)

## Remarks.
- In genus \(0\) one can verify the claim directly from the closed formula
  \[\displaystyle \int_{\overline{\mathcal M}_{0,n}}\prod_i \psi_i^{e_i}=\frac{(n-3)!}{\prod_i (2e_i-1)!!},\]
  together with the fact that the sequence \(a_m=(2m-1)!!\) is log–convex (\(a_{m+1}/a_m=2m+1\) increases). Hence the denominator is minimized—and the integral maximized—precisely when the \(e_i\) are as equal as possible.
- The log–concavity in Step 2 is a special case of the Khovanskii–Teissier (or Alexandrov–Fenchel) inequalities for nef classes; it can be proved by restricting to a general complete intersection surface and applying the Hodge index theorem, or via the mixed Hodge–Riemann bilinear relations. The reduction from the stack to a smooth projective variety can be made using a finite level-structure cover; intersection numbers scale by the degree of the cover, so inequalities are preserved.

This completes the proof that \(D\) attains its maximum on a balanced vector in \(E(g,n)\).