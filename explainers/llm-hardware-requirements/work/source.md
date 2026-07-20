# What It Takes to Run an AI Model: The Hardware Requirements of Modern LLMs

## The question everyone suddenly has to answer

On July 27, 2026, Moonshot AI releases the weights of Kimi K3 — a 2.8-trillion-parameter model, the world's first open model in the 3T class. Anyone can download it. Almost no one can run it. Loading K3 for inference requires roughly 1.4 terabytes of GPU memory, and Moonshot's recommended minimum deployment is a "supernode" of 64 or more accelerators. Meanwhile an 8-billion-parameter model runs comfortably on a MacBook, and a 70-billion-parameter model fits on a single high-end workstation card if you compress it.

Why does one model need a data center while another runs on a laptop? The answer comes down to a small set of arithmetic rules that anyone can learn. Once you know them, you can look at any model's spec sheet and work out for yourself what hardware it needs, how fast it can possibly run, and why the industry is building the way it is. Kimi K3 is the perfect worked example, because it uses every trick in the book — sparse experts, aggressive quantization, a new attention mechanism — and each trick exists to bend one of these arithmetic rules.

## Rule 1: A model is a pile of numbers, and every number needs a home

A language model's "parameters" (also called weights) are just numbers — billions or trillions of them — that were tuned during training and are read during every response the model generates. An 8B model is a list of 8 billion numbers. Kimi K3 is a list of 2.8 trillion numbers.

To generate text, all of those numbers must sit in memory that the processor can read at extreme speed. For GPUs this memory is called VRAM (the GPU's on-board memory); on Apple Silicon it's the machine's unified memory. Ordinary disk or even system RAM is far too slow to serve weights at generation speed, so VRAM capacity is the first and hardest constraint: if the weights don't fit, the model doesn't run, no matter how fast the chip is.

The memory a model's weights occupy is a simple product:

**weights memory = number of parameters × bytes per parameter**

## Rule 2: The bytes-per-parameter dial — precision and quantization

Each parameter is stored at some numerical precision, and precision is measured in bytes:

- FP32 (full precision, used mostly in training): 4 bytes per parameter
- BF16 / FP16 (the standard release format): 2 bytes per parameter
- FP8 / INT8: 1 byte per parameter
- 4-bit formats (INT4, MXFP4): 0.5 bytes per parameter

Storing a parameter in fewer bytes is called quantization — rounding each number to a coarser grid so it takes less room. Quantization cuts memory in direct proportion: the same model at 4-bit needs one quarter of the memory it needs at BF16. The cost is a small loss of fidelity in each number, which done naively degrades the model's intelligence.

The multiplication table for real models:

- Llama 3.1 8B: 8B × 2 bytes = 16 GB at BF16; 8B × 0.5 = about 4.5 GB at 4-bit
- Llama 3.3 70B: 70B × 2 bytes = 140 GB at BF16; 70B × 0.5 = about 35 GB at 4-bit
- Kimi K2 (1T parameters): 1T × 0.5 bytes ≈ 500 GB — its released INT4 weight files total 594 GB (some layers are kept at higher precision)
- Kimi K3 (2.8T parameters): 2.8T × 0.5 bytes = 1.4 TB at 4-bit; it would be roughly 2.8 TB at FP8 and 5.6 TB at BF16

Kimi K3 does something newer than after-the-fact compression: quantization-aware training. From the supervised fine-tuning stage onward, K3 is trained already living at low precision — MXFP4 weights with MXFP8 activations — so the 4-bit version is not a lossy copy of a "real" model; it is the model. That is why 1.4 TB, not 5.6 TB, is K3's honest memory footprint.

## Rule 3: Match the footprint to the hardware — the ladder

Real machines come in memory tiers, and the weights number tells you immediately which tier a model lands on:

- A MacBook Pro has 16–128 GB of unified memory. An RTX 4090, the classic enthusiast GPU, has 24 GB of VRAM; an RTX 5090 has 32 GB.
- A data-center GPU: NVIDIA H100 has 80 GB, H200 has 141 GB, B200 has 192 GB.
- A standard server node packs 8 data-center GPUs: 8 × H200 = 1,128 GB (about 1.1 TB).
- Beyond one node, GPUs are lashed together with high-speed interconnect into clusters — Moonshot's recommended K3 deployment is a supernode of 64+ accelerators.

Now the ladder falls out of the arithmetic:

- 8B at 4-bit (about 4.5 GB) fits on nearly any modern laptop with room to spare.
- 70B at 4-bit (about 35 GB) fits on one 48 GB workstation card or a 64 GB Mac; at BF16 (140 GB) it already needs two H100s.
- Kimi K2 at INT4 (594 GB) fills most of an 8 × H200 node — the biggest single box you can buy.
- Kimi K3 at 4-bit (1.4 TB of weights alone) cannot fit in any single node with room left over for anything else. It is the first open model whose minimum viable home is a multi-node GPU cluster. Eight B200s (1,536 GB) could technically hold the weights, but with almost nothing left for the working memory described next — hence 64+ accelerators in practice.

## Rule 4: The conversation itself takes memory — the KV cache

Weights are not the whole bill. While generating, a model keeps a running record of everything in the current context — every token of the conversation, document, or codebase it's attending to. This record is called the KV cache (key–value cache), and it grows in direct proportion to context length: twice the tokens, twice the cache.

The per-token cost depends on the model's internal dimensions, and it adds up brutally at scale. Llama 3.3 70B needs about 320 KB of KV cache per token of context at 16-bit precision. A full 128,000-token context therefore costs about 40 GB — as much memory as the model's entire quantized weights. This is why "context window" is a hardware number, not just a marketing number: long context is paid for in gigabytes.

Kimi K3 advertises a native 1-million-token context window — roughly 8× the norm — which under conventional attention would make the KV cache the dominant memory cost. K3's answer is an architectural change: Kimi Delta Attention (KDA), a hybrid linear-attention mechanism that keeps a compact running summary instead of a full per-token record for most layers. Moonshot reports up to 6.3× faster decoding at 1M-token context compared to conventional attention. The general lesson holds for every model: total memory = weights + KV cache + overhead, and the KV term is the one that grows as you use the model harder.

## Rule 5: Memory bandwidth sets the speed limit

Capacity determines whether a model runs; memory bandwidth — how many bytes per second the processor can read from its memory — determines how fast. To generate one token, the model must read essentially all of its (active) weights from memory once. So there is a hard ceiling:

**max tokens per second ≈ memory bandwidth ÷ bytes read per token**

Concrete numbers: an M4 Max MacBook moves 546 GB/s; an RTX 4090 about 1 TB/s; an H100 3.35 TB/s; a B200 about 8 TB/s.

- An 8B model at 4-bit (4.5 GB to read per token) on an M4 Max: 546 ÷ 4.5 ≈ 120 tokens/second ceiling. This is why small models feel instant on laptops.
- A 70B model at 4-bit (35 GB per token) on one H100: 3,350 ÷ 35 ≈ 95 tokens/second ceiling.
- A hypothetical dense 2.8T model at 4-bit would need to read 1.4 TB per token. Even on an H100's 3.35 TB/s, that is a ceiling of about 2.4 tokens per second — unusably slow no matter how much memory you buy.

That last line is the punchline: at the trillion-parameter scale, the naive architecture doesn't just cost too much memory — it is too slow to read itself. Something structural has to change.

## The escape hatch: Mixture-of-Experts — pay for storage, not for reading

The structural change is the Mixture-of-Experts (MoE) architecture. Instead of one monolithic network that every token passes through, an MoE model's layers are split into many parallel "experts," and a small router picks a handful of them for each token. The full roster of experts must all sit in memory — any token might need any expert — but each individual token only reads a small fraction.

This splits the two costs that dense models pay together:

- Total parameters set the memory (storage) requirement.
- Active parameters per token set the compute and bandwidth requirement — the per-token bill.

The Kimi lineage shows the design scaling up. Kimi K2: 1 trillion total parameters, 384 experts, 8 active per token — about 32B active. Kimi K3: 2.8 trillion total, 896 experts, 16 routed experts active per token — roughly 50B active parameters, under 2% of the model. K3's expert layout (Moonshot calls it Stable LatentMoE) routes each token by quantile — an expert takes the token if the router's score for it lands in the top quantile — which keeps all 896 experts evenly used, with no "dead" experts wasting memory.

Redo the speed arithmetic with sparsity: K3 reads about 50B active parameters × 0.5 bytes = 25 GB per token instead of 1.4 TB — a 56× smaller read. Spread the weights across a 64-GPU supernode and the aggregate memory bandwidth serves that 25 GB quickly enough for fluid generation. MoE is why a 2.8T model is usable at all: you pay a storage-sized bill for memory but only a 50B-sized bill per token.

## Why this beats the old way, in dollars

The economics follow the arithmetic. A dense model with K3's quality would have to read its entire bulk for every token; K3 reads under 2% of itself. Moonshot reports roughly 2.5× better scaling efficiency for K3 versus its own K2 — more capability per unit of training compute — and the operating cost shows up directly in the API price: $3.00 per million input tokens (or $0.30 when the input is cached from a previous request), $15.00 per million output tokens. Serving a frontier-scale model at those prices is only possible because per-token compute is decoupled from total size.

The same decoupling explains the caching discount, which matters enormously in practice: in agentic coding workloads, where the same large codebase context is resent on every request, over 90% of input tokens hit the cache — the model keeps the KV cache for the repeated prefix and skips recomputing it, and the 10× cheaper cache-hit price passes the savings on.

## Why now

Three curves crossed to make a 2.8T open model possible in 2026:

1. Hardware learned 4-bit. NVIDIA's Blackwell generation (B200 and kin) executes 4-bit floating-point math natively in hardware. Quantization stopped being just a storage trick and became the fast path — which is what makes training a model at MXFP4 from the start (as K3 does) the rational choice rather than a compromise.
2. Models outgrew the single box. Kimi K2's 594 GB nearly filled the biggest 8-GPU server; the next scaling step had nowhere to go but multi-node supernodes with fast interconnect. K3 is the first open model designed on the assumption that the cluster, not the server, is the unit of deployment.
3. Open weights moved the question from labs to everyone. When frontier-class weights are downloadable, "what hardware does this need?" stops being a data-center procurement question and becomes something every developer, startup, and university has to reason about — using exactly the arithmetic above: parameters × bytes for memory, active parameters × bytes over bandwidth for speed, plus a KV budget that grows with context.

The rules are stable even as the numbers race upward. An 8B model on a laptop, a 70B model on a workstation card, and a 2.8T-parameter Kimi K3 on a 64-GPU supernode are all obeying the same three lines of arithmetic — they've just chosen different points on the ladder.
