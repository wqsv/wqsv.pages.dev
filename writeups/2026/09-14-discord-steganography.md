---
title: "Building Robust Image Steganography That Survives Discord"
description: "A technical walkthrough of image steganography designed to survive Discord profile-picture processing."
pubDate: 2026-09-14
canonicalSlug: "2026/09-14-discord-steganography"
readingTime: "20-24 minute read"
---
Traditional image steganography often starts with a simple idea: replace the least significant bits (LSBs) of selected pixels with a message, then read those bits back later. The method is easy to implement and works well when the image remains unchanged.

That assumption breaks down when an image passes through a platform that resizes or re-encodes it. Discord may return a processed version of a profile picture rather than the original file, so a decoder cannot rely on every pixel retaining its exact value. The hidden message has to survive a lossy channel.

This project began with a practical question: could a short text message be hidden in an image, uploaded as a Discord profile picture, and recovered from the processed image?

The result was a working prototype that recovered a short message after the tested Discord profile-picture workflow. The final design combines an 8×8 discrete cosine transform (DCT), coefficient-difference embedding, repetition, interleaving, BCH error correction, and CRC32 integrity checking. It also normalizes the carrier image before embedding so that the encoder and decoder use the same block geometry.

The embedding primitive belongs to a known family of coefficient-pair techniques. The parameters and system as a whole, however, were assembled and tuned experimentally for one specific processing path.

> **Scope of the experiment**
>
> This article concerns Discord <strong>profile pictures (PFPs)</strong>, not ordinary image attachments. The encoder normalizes the carrier to 1024×1024, embeds the message, and writes a PNG. In the tested workflow, Discord returned a 1024×1024 WebP, which the decoder then processed.
> The pipeline is:
>
> ```
> Input image
>    ↓
> Normalize to 1024×1024
>    ↓
> Embed message
>    ↓
> Encoded PNG
>    ↓
> Discord profile-picture processing
>    ↓
> Downloaded WebP
>    ↓
> Decode message
> ```
>
> As far as we could find, Discord's exact image-processing pipeline is not publicly documented anywhere. The results therefore apply to the workflow tested here; how well the method performs under other processing conditions remains untested.


### Table of contents
- [1. Why LSB steganography failed](#1-why-lsb-steganography-failed)
  - [1.1. Starting with LSB](#11-starting-with-lsb)
  - [1.2. What went wrong](#12-what-went-wrong)
- [2. The problem: surviving a lossy channel](#2-the-problem-surviving-a-lossy-channel)
  - [2.1. Experimental progression](#21-experimental-progression)
- [3. Embed information in the DCT domain](#3-embed-information-in-the-dct-domain)
  - [3.1. From pixels to frequency coefficients](#31-from-pixels-to-frequency-coefficients)
  - [3.2. Encode a relationship, not an exact value](#32-encode-a-relationship-not-an-exact-value)
  - [3.3. Modify luminance, not every color channel](#33-modify-luminance-not-every-color-channel)
- [4. Make the message recoverable when bits are wrong](#4-make-the-message-recoverable-when-bits-are-wrong)
  - [4.1. Repetition gives the decoder multiple observations](#41-repetition-gives-the-decoder-multiple-observations)
  - [4.2. Why repetition alone is too expensive](#42-why-repetition-alone-is-too-expensive)
  - [4.3. Hamming code was a useful first step](#43-hamming-code-was-a-useful-first-step)
  - [4.4. BCH(31,21) handles more residual errors](#44-bch3121-handles-more-residual-errors)
  - [4.5. CRC32 tells us whether to trust the result](#45-crc32-tells-us-whether-to-trust-the-result)
- [5. Protect against correlated errors](#5-protect-against-correlated-errors)
  - [5.1. Shuffle observations across the image](#51-shuffle-observations-across-the-image)
  - [5.2. Interleave bits across codewords](#52-interleave-bits-across-codewords)
- [6. Protect the header as well as the payload](#6-protect-the-header-as-well-as-the-payload)
- [7. Use one coefficient pair per block](#7-use-one-coefficient-pair-per-block)
- [8. The final encoder and decoder](#8-the-final-encoder-and-decoder)
  - [8.1. Message format](#81-message-format)
  - [8.2. Encoding](#82-encoding)
  - [8.3. Decoding](#83-decoding)
  - [8.4. Final configuration](#84-final-configuration)
- [9. Results and tradeoffs](#9-results-and-tradeoffs)
  - [9.1. A successful Discord round-trip](#91-a-successful-discord-round-trip)
  - [9.2. Increasing the coefficient margin](#92-increasing-the-coefficient-margin)
  - [9.3. Visual quality and the cross-hatch effect](#93-visual-quality-and-the-cross-hatch-effect)
  - [9.4. Carrier dimensions are part of synchronization](#94-carrier-dimensions-are-part-of-synchronization)
  - [9.5. Capacity and the cost of robustness](#95-capacity-and-the-cost-of-robustness)
  - [9.6. What the experiment does and does not show](#96-what-the-experiment-does-and-does-not-show)
- [10. What we learned](#10-what-we-learned)
  - [Steganography is not encryption](#steganography-is-not-encryption)
- [Source code](#source-code)

<a id="1-why-lsb-steganography-failed"></a>

### 1. Why LSB steganography failed

<a id="11-starting-with-lsb"></a>

#### 1.1. Starting with LSB
The goal was to hide a short plaintext message inside a 1024×1024 black-and-white VHS static image (aka the carrier) and recover it after using the image as a Discord PFP.

We started with least significant bit (LSB) steganography, a natural first choice for this kind of experiment. It is straightforward to implement, easy to decode, and makes only tiny changes to pixel values. Since we hadn't yet established how Discord processed uploaded PFPs, it made sense to begin with a simple approach and see whether the message survived.

For example, changing an 8-bit RGB channel/pixel value from `182 (10110110)` to `183 (10110111)` flips its least significant bit while making virtually no visible difference. If the image remains preserved exactly at the pixel level, the decoder can recover the embedded bit.

<a id="12-what-went-wrong"></a>

#### 1.2. What went wrong
After uploading the image to Discord, we found that it re-encoded the PFP, altering pixel values in the process. Although the image still looked almost identical, the embedded bits were no longer reliably preserved.

Even a change of one in a pixel value can flip an LSB. Across enough pixels, these errors corrupted the message. In one test, the decoder interpreted the recovered bytes as an implausible message length of `2456687191`. (That early prototype used a different header layout; the value was simply corrupted data interpreted as a 32-bit length. The final format described below uses a 16-bit length field.)

LSB encoding wasn't inherently flawed. It simply wasn't robust enough for this particular pipeline. We needed to encode information in image properties that could survive re-encoding.

<a id="2-the-problem-surviving-a-lossy-channel"></a>

### 2. The problem: surviving a lossy channel
Using an 8×8 block grid in a 1024×1024 image gives us 128 blocks in each dimension, or 16,384 blocks in total:
```
1024 / 8 = 128
128 * 128 = 16384
```

At first glance, that seems like plenty of space for a short message. However, each block provides only one opportunity to make a measurement; it does not necessarily represent one reliable message bit. Once we account for redundancy and error correction, the number of blocks we can use to carry actual information becomes much smaller.

The challenge was to balance three competing goals: robustness, visual quality, and payload capacity. Adding redundancy helps recover corrupted bits, while making embedded bits more resistant to image processing requires stronger modifications to the carrier. Both come at a cost: fewer bits can be embedded without sacrificing reliability or visual quality.

<a id="21-experimental-progression"></a>

#### 2.1. Experimental progression
The table below summarizes how the design evolved in response to failures and test results. Each stage is explained in more detail in the sections that follow.

<div class="table-scroll">
<table border="1" cellpadding="6" cellspacing="0">
<thead>
<tr>
<th>Design stage</th>
<th>What we observed</th>
<th>Change made</th>
<th>Why it helped</th>
</tr>
</thead>
<tbody>
<tr>
<td>LSB embedding</td>
<td>Discord processing changed pixel values and corrupted the recovered bitstream.</td>
<td>Move the payload out of exact pixel LSBs.</td>
<td>A representation based on a relationship between transform coefficients can tolerate some numerical changes.</td>
</tr>
<tr>
<td>DCT coefficient-difference embedding</td>
<td>Some decoded bits still flipped when the selected coefficients were too close together.</td>
<td>Encode each bit using the sign of a deliberately separated coefficient pair.</td>
<td>A wider separation gives processing more room to perturb coefficients without reversing their order.</td>
</tr>
<tr>
<td>Repetition</td>
<td>Individual observations remained unreliable, but repeating every bit many times consumed nearly all available blocks.</td>
<td>Use repetition together with error-correcting codes.</td>
<td>Repetition provides multiple observations, while coding handles residual errors more efficiently.</td>
</tr>
<tr>
<td>Hamming(15,11)</td>
<td>Observed errors sometimes exceeded its one-bit-per-codeword correction capability.</td>
<td>Move to BCH(31,21), configured for up to two bit errors per codeword.</td>
<td>The stronger code can correct more residual errors, at the cost of additional redundancy.</td>
</tr>
<tr>
<td>Payload-only protection</td>
<td>A corrupted header could make the decoder misread the message format or length before payload recovery.</td>
<td>Protect the header with BCH, interleaving, and repetition too.</td>
<td>The decoder can recover and validate the metadata it needs to interpret the payload.</td>
</tr>
<tr>
<td>Multiple coefficient pairs per block</td>
<td>Embedding the same bit in two pairs required four coefficient modifications and increased visible distortion.</td>
<td>Keep one pair, <code>(2,3)/(3,2)</code>, per block.</td>
<td>Spatial repetition and error correction supply redundancy without making multiple local modifications for each bit.</td>
</tr>
<tr>
<td>Mismatched image dimensions</td>
<td>The encoder and decoder built different block lists, so the same shuffle seed selected different physical blocks.</td>
<td>Normalize the carrier to 1024×1024 before embedding.</td>
<td>Both sides use the same block geometry and deterministic mapping.</td>
</tr>
<tr>
<td>Insufficient margin in a test run</td>
<td>In the reported comparison, the Δ=20 configuration failed its CRC check and included an uncorrectable payload codeword.</td>
<td>Increase the margin to Δ=25.</td>
<td>Subsequent tests decoded successfully.</td>
</tr>
<tr>
<td>Higher margin and reduced repetition</td>
<td>With Δ=35, the tested message survived with 20× payload repetition and 15× header repetition.</td>
<td>Increase the margin to Δ=35 and reduce repetition from the earlier 30× payload / 25× header configuration.</td>
<td>Lower repetition freed blocks for a larger payload: 60 bytes at 20×/15× (16,120 of 16,384 blocks used), versus 35 bytes at 30×/25×.</td>
</tr>
</tbody>
</table>
</div>

**Tip**: This table may make more sense after you've finished reading the article.

<a id="3-embed-information-in-the-dct-domain"></a>

### 3. Embed information in the DCT domain
<a id="31-from-pixels-to-frequency-coefficients"></a>

#### 3.1. From pixels to frequency coefficients
The discrete cosine transform (DCT) represents an image block in terms of spatial frequencies. We divide the luminance channel into 8×8 blocks and transform each block into 64 coefficients.

```text
8×8 pixel block
       ↓
      DCT
       ↓
64 frequency coefficients
```

Coefficients near the top-left of the block represent lower spatial frequencies, such as broad changes in brightness. Coefficients farther from that corner represent finer detail. 

These frequencies behave differently during image processing. High-frequency details are often more vulnerable to compression, while modifying low-frequency components too aggressively can introduce visible distortions.

So, we needed a coefficient pair that offered a reasonable balance between robustness and visual quality. The right choice depends on the image and the processing pipeline, so the final coefficient locations were selected through testing rather than assumed to be universally optimal.

<a id="32-encode-a-relationship-not-an-exact-value"></a>

#### 3.2. Encode a relationship, not an exact value
Instead of storing a bit in an exact coefficient value, we encode it in the relationship between two coefficients. The implementation uses positions `(2,3)` and `(3,2)` in each 8×8 block. Let their values be A and B.

The decoder reads the sign of their difference:

```text
A - B >= 0  →  1
A - B < 0   →  0
```
The advantage is that small changes to both coefficients do not necessarily change their ordering. As long as A remains greater than B, the decoder reads a one, even if their exact values have changed.

However, if the coefficients are very close together, even a small perturbation can reverse their ordering. To reduce this risk, we deliberately separate them by a margin.

First, the encoder calculates the pair's midpoint:

```text
midpoint = (A + B) / 2
```

Then we choose a target difference based on the bit we want to embed:

```text
bit 0 → target difference = -Δ
bit 1 → target difference = +Δ
```

Finally, we reconstruct the coefficients around the same midpoint:

```text
A' = midpoint + target / 2
B' = midpoint - target / 2
```

This keeps the midpoint unchanged while setting the difference between the modified coefficients to the target value. The earlier successful configuration used Δ=25, giving an intended difference of approximately −25 for a zero and +25 for a one. In a later experiment, increasing the margin to Δ=35 also succeeded and allowed lower repetition factors.

In other words, the encoder does not rely on the coefficients having exact values after upload. It relies on their ordering surviving image processing. A larger margin makes that ordering harder to reverse, although it can also increase visual distortion.

This is coefficient-difference embedding. It superficially resembles quantization index modulation (QIM), but it is not textbook QIM: QIM quantizes a single coefficient to a lattice (rounding, for example, to the nearest even value for a 0 and the nearest odd value for a 1), whereas this method preserves the pair's midpoint and sets the difference between two coefficients to ±Δ.

The approach belongs to the coefficient-pair comparison family introduced by Koch and Zhao (1995). I arrived at it independently while experimenting and learned of the earlier work only afterward. The contribution of this project is the surrounding error-correction and synchronization stack.

<a id="33-modify-luminance-not-every-color-channel"></a>

#### 3.3. Modify luminance, not every color channel
We embed data in the luminance channel (Y) of a YCbCr image, leaving the chrominance channels (Cb and Cr) unchanged during embedding:

```text
RGB → YCbCr
         ├── Y  → modified
         ├── Cb → unchanged
         └── Cr → unchanged
```

After modifying the Y channel, we recombine the channels and convert the image back to RGB.

This gives us one coefficient-pair measurement per 8×8 block. The method is more robust than direct LSB replacement in our tested workflow, but some bits can still be corrupted. The next step was to make the message recoverable even when individual measurements were wrong.

<a id="4-make-the-message-recoverable-when-bits-are-wrong"></a>

### 4. Make the message recoverable when bits are wrong
Even with a robust embedding method, some bits may be corrupted during image processing. Rather than relying on every measurement being correct, we need redundancy and error correction to recover the original message.

<a id="41-repetition-gives-the-decoder-multiple-observations"></a>

#### 4.1. Repetition gives the decoder multiple observations

The simplest way to add redundancy is to embed each coded bit multiple times. If a bit is repeated 25 times and the decoder reads 19 ones and 6 zeros, majority voting recovers a one.

Repetition doesn't make individual observations more reliable. It gives the decoder several observations to combine. It works best when errors are not strongly correlated across those observations.

The final configuration uses different repetition factors for the two parts of the message:

- **Header:** 15 copies per coded bit.
- **Payload:** 20 copies per coded bit.

These values were selected experimentally for this carrier and processing pipeline. They are not general-purpose constants.

<a id="42-why-repetition-alone-is-too-expensive"></a>

#### 4.2. Why repetition alone is too expensive
The carrier has 16,384 blocks, each providing one coefficient-pair measurement. An early experiment used a repetition factor of 75 for a payload containing 216 raw/payload bits:

```text
216 * 75 = 16,200 block measurements
```

That left almost no room for the rest of the message structure. Despite the high repetition factor, errors could still remain.

The solution was to combine repetition with error-correcting codes. Repetition provides multiple observations of each coded bit, while error-correcting codes handle residual errors more efficiently.

<a id="43-hamming-code-was-a-useful-first-step"></a>

#### 4.3. Hamming code was a useful first step
The first error-correcting code tested was **Hamming(15,11)**. It takes 11 data bits and adds 4 parity bits, producing a 15-bit codeword. The parity bits occupy positions that are powers of two: 1, 2, 4, and 8; the remaining positions hold the data bits.

Rather than go through the parity-check theory, let's follow a single error.

Suppose the encoder produces a codeword, and bit 11 gets flipped during image processing:
```text
Original codeword:  101101001011010
Received codeword:  101101001001010
                              ^
                         bit 11 flipped
```
Each parity bit checks a particular group of positions. Position 11's binary representation is 1011. Reading the digits from right to left, the 1s indicate that position 11 participates in the checks for positions 1, 2, and 8, but not position 4.

When bit 11 flips, each of those three checks changes from passing to failing, while the check for position 4 still passes. Reading the check results in the order 8, 4, 2, 1 gives 1011 (the binary representation of 11).

This pattern of failed checks is called the syndrome. It identifies the flipped bit, so the decoder flips position 11 back and recovers the original codeword.

A zero syndrome means that all parity checks pass, but it does not guarantee that the codeword is error-free: some multiple-bit error patterns can go undetected.

Hamming(15,11) can correct only one bit error per codeword. With two errors, the syndrome may point to an incorrect position, so flipping the indicated bit can make matters worse. In our experiments, the observed errors exceeded what this code could reliably correct, prompting us to try a stronger code.

<a id="44-bch3121-handles-more-residual-errors"></a>

#### 4.4. BCH(31,21) handles more residual errors
The final system uses BCH(31,21), configured to correct up to two bit errors per codeword. It encodes 21 data bits into a 31-bit codeword.
The same idea applies, but the decoder can now recover from two flipped bits in the same codeword:

```text
Original codeword:  1011010010110101100101011010011
Received codeword:  1011011010110101100001011010011
                         ^         ^
                    two flipped bits
```

The BCH decoder uses its error-correction algorithm to locate and correct both errors, recovering the original codeword and its 21 information bits.

Three or more errors in one codeword exceed its guaranteed correction capability. The decoder may report a failure, or it may produce an incorrect result. It is therefore important to keep the distinction between correcting up to two errors and guaranteeing recovery from any number of errors.

Compared with Hamming(15,11), BCH(31,21) adds more redundancy and costs more capacity but can correct more errors within each codeword. For our short-message experiment, that trade-off was worthwhile.

Repetition and BCH serve different purposes:

- **Repetition** combines multiple observations of a coded bit.
- **BCH decoding** corrects residual errors in the resulting codeword.

Neither replaces the other. The design uses both because the channel can corrupt individual observations and leave errors even after voting.

<a id="45-crc32-tells-us-whether-to-trust-the-result"></a>

#### 4.5. CRC32 tells us whether to trust the result
Even error correction cannot guarantee that every decoded message is correct. A failed reconstruction can still produce bytes that look plausible.

To detect this, the message includes a CRC32 checksum calculated from the original payload. After decoding, the receiver calculates the checksum again and compares it with the stored value. If the checksums differ, the reconstruction is rejected.

CRC32 is an **error-detection** mechanism here, not an error-correcting code. It does not repair corrupted data. Its role is to prevent a failed reconstruction from being accepted as a successful decode.

Together, repetition, BCH, and CRC32 provide three distinct functions: multiple observations, correction of residual bit errors, and validation of the recovered payload.

<a id="5-protect-against-correlated-errors"></a>

### 5. Protect against correlated errors
The previous section describes how the system handles errors, but it leaves out an important assumption: repetition works best when its observations fail independently.

Suppose the encoder places 25 copies of a bit in neighboring blocks. A local image artifact may affect many of those blocks at once. The decoder then receives a cluster of bad observations instead of 25 independent chances to recover the bit.

These are **correlated errors**. Simply increasing the repetition factor may not help much if many copies are exposed to the same local disturbance.

<a id="51-shuffle-observations-across-the-image"></a>

#### 5.1. Shuffle observations across the image
The encoder therefore distributes repeated observations throughout the carrier instead of placing them in consecutive blocks. A bit might be assigned to blocks 17, 438, 2911, 9042, and 15003, rather than blocks 1 through 5.

The implementation uses a deterministic block permutation with the public seed:

```text
0x6D2B79F5
```

The seed is not a secret. It ensures that the encoder and decoder generate the same block ordering. Spreading repeated observations across the image reduces the chance that one localized artifact will damage all copies of a bit.

<a id="52-interleave-bits-across-codewords"></a>

#### 5.2. Interleave bits across codewords
Block shuffling spreads repeated observations spatially. **Interleaving** addresses a related but different problem: how errors are distributed among error-correcting codewords.

Imagine that a local artifact corrupts four nearby embedded bits. If all four belong to the same BCH codeword, that codeword may exceed the decoder's two-error correction capability. If interleaving distributes those bits across four different codewords, each codeword may contain only one error, which BCH can correct.

Interleaving rearranges the coded bitstream before embedding. The decoder reverses the permutation after extraction to restore the original codeword order.

The two mechanisms are complementary:

- **Block shuffling** spreads repeated observations across the image.
- **Interleaving** spreads nearby embedded bits across different BCH codewords.

Both are deterministic and reversible. Neither prevents errors; they reduce the chance that a localized disturbance will overwhelm the error-correction stage.

<a id="6-protect-the-header-as-well-as-the-payload"></a>

### 6. Protect the header as well as the payload
An early version protected the payload but left the header comparatively vulnerable. That created a subtle failure mode: the payload could be recoverable, yet corrupted metadata could prevent the decoder from interpreting it.

The header carries the information needed to identify and validate the message:

```text
4-byte magic value
2-byte message length
4-byte CRC32
```

The magic value identifies the expected format, the length tells the decoder how many payload bytes to read, and CRC32 helps detect corruption in the recovered payload.

The final implementation protects the header with the same BCH-based error-correction pipeline as the payload. Both use BCH encoding, interleaving, and repetition, but with different repetition factors: 15 for the header and 20 for the payload.

This matters because metadata is part of the message, not just bookkeeping. If the header is corrupted, the decoder may read the wrong number of bytes or validate the payload against the wrong checksum. Protecting the header safely closes that gap.

<a id="7-use-one-coefficient-pair-per-block"></a>

### 7. Use one coefficient pair per block

In the beginning, we embedded the same bit using two coefficient pairs in each block:

```text
(0,1) ↔ (1,0)
(1,2) ↔ (2,1)
```

This supplied an additional local measurement, but it also required modifying four DCT coefficients for each embedded bit. We later found that this wasn't necessary once repetition, block shuffling, interleaving, and BCH protection were in place.

The final design uses only `(2,3) ↔ (3,2)`, giving one coefficient-pair measurement per block.

The tradeoff is straightforward. Modifying more coefficient pairs can provide more local evidence, but it also changes more of the carrier and can increase visible distortion. Using one pair keeps the modification simpler and relies on system-level redundancy for recovery.

<a id="8-the-final-encoder-and-decoder"></a>

### 8. The final encoder and decoder
The final system combines the embedding and recovery stages into a single pipeline. The following describes the logical order of operations; implementation details such as padding and bit ordering must remain consistent between encoder and decoder.

<a id="81-message-format"></a>

#### 8.1. Message format
The plaintext is encoded as UTF-8. A 10-byte header precedes the payload:

<div class="table-scroll">
<table border="1" cellpadding="6" cellspacing="0">
<thead>
<tr><th>Field</th><th>Size</th><th>Purpose</th></tr>
</thead>
<tbody>
<tr><td>Magic value = b'BCH7'</td><td>4 bytes</td><td>Identifies the format</td></tr>
<tr><td>Message length</td><td>2 bytes</td><td>Specifies the payload length</td></tr>
<tr><td>CRC32</td><td>4 bytes</td><td>Checks payload integrity</td></tr>
</tbody>
</table>
</div>

The trailing `7` in `b'BCH7'` is arbitrary. It is not a reference to a BCH code with 7-bit codewords; the code used here is BCH(31,21). The message length is stored in a 16-bit field and the checksum in a 32-bit field.

<a id="82-encoding"></a>

#### 8.2. Encoding
```text
Plaintext
    ↓
Encode as UTF-8
    ↓
Calculate CRC32
    ↓
Build header + payload
    ↓
BCH-encode header and payload
    ↓
Interleave each coded stream
    ↓
Repeat coded bits
    ├── Header: 15×
    └── Payload: 20×
    ↓
Normalize carrier to 1024×1024
    ↓
Convert RGB to YCbCr
    ↓
Divide Y into 8×8 blocks and apply DCT
    ↓
Assign observations to blocks using a deterministic block shuffle
    ↓
Embed each bit in the (2,3)/(3,2) coefficient difference
    ↓
Apply inverse DCT
    ↓
Recombine channels and convert to RGB
    ↓
Save encoded PNG
```
<a id="83-decoding"></a>

#### 8.3. Decoding
```text
Processed Discord image
    ↓
Convert to YCbCr and select Y
    ↓
Divide into 8×8 blocks and apply DCT
    ↓
Measure the (2,3)/(3,2) coefficient difference
    ↓
Recover repeated header observations and vote
    ↓
Deinterleave and BCH-decode the header
    ↓
Validate header and read payload length
    ↓
Recover the required payload observations and vote
    ↓
Deinterleave and BCH-decode the payload
    ↓
Recalculate CRC32
    ↓
Reject if the checksum does not match
    ↓
Decode the recovered bytes as UTF-8
```

<a id="84-final-configuration"></a>

#### 8.4. Final configuration
<div class="table-scroll">
<table border="1" cellpadding="6" cellspacing="0">
<thead>
<tr><th>Parameter</th><th>Value</th></tr>
</thead>
<tbody>
<tr><td>Carrier size</td><td>1024×1024</td></tr>
<tr><td>Input normalization</td><td>Resize to 1024×1024 before embedding</td></tr>
<tr><td>Block size</td><td>8×8</td></tr>
<tr><td>Transform</td><td>DCT</td></tr>
<tr><td>Color representation</td><td>YCbCr</td></tr>
<tr><td>Modified channel</td><td>Y only</td></tr>
<tr><td>Coefficient pair</td><td>(2,3)/(3,2)</td></tr>
<tr><td>Embedding margin</td><td>Δ=35</td></tr>
<tr><td>Header repetition</td><td>15×</td></tr>
<tr><td>Payload repetition</td><td>20×</td></tr>
<tr><td>Error-correcting code</td><td>BCH(31,21), t=2</td></tr>
<tr><td>Interleaving</td><td>Deterministic</td></tr>
<tr><td>Block ordering</td><td>Deterministic public shuffle</td></tr>
<tr><td>Shuffle seed</td><td><code>0x6D2B79F5</code></td></tr>
<tr><td>Payload encoding</td><td>UTF-8</td></tr>
<tr><td>Integrity check</td><td>CRC32</td></tr>
<tr><td>Secret key</td><td>None</td></tr>
<tr><td>Practical payload capacity</td><td>60 bytes</td></tr>
<tr><td>Tested channel</td><td>Discord profile picture → WebP → decoder</td></tr>
</tbody>
</table>
</div>

<a id="9-results-and-tradeoffs"></a>

### 9. Results and tradeoffs

<a id="91-a-successful-discord-round-trip"></a>

#### 9.1. A successful Discord round-trip
In the successful round-trip, the encoded PNG was used as a Discord PFP.

A successful decode produced the following results:

```text
Header corrected codewords: 0
Header uncorrectable codewords: 0
Payload corrected codewords: 0
Payload uncorrectable codewords: 0
Low-margin payload bits: 0/713
SUCCESS
Message: Watching everything spin and circling around cluelessly. x_x
```

This log demonstrates that the decoder recovered the message. In this run, the BCH decoder reported no corrected or uncorrectable codewords.

A successful decode doesn't necessarily mean that the image was unchanged. It means the full system recovered the original payload despite the tested processing pipeline.

<a id="92-increasing-the-coefficient-margin"></a>

#### 9.2. Increasing the coefficient margin
The experiments compared embedding margins of Δ=20 and Δ=25, keeping the other settings unchanged.

With Δ=25, a WebP decode succeeded:

```text
Header corrected codewords: 0
Header uncorrectable codewords: 0
Payload corrected codewords: 4
Payload uncorrectable codewords: 0
Low-margin payload bits: 11/434
Actual CRC: 6caeddc7
SUCCESS

Message: 6357: You actually found it. DM me!
```

The corresponding Δ=20 test failed its integrity check:

```text
Header corrected codewords: 3
Header uncorrectable codewords: 0
Payload corrected codewords: 8
Payload uncorrectable codewords: 1
Low-margin payload bits: 75/434
CRC: incorrect
PAYLOAD CORRUPTED
```

Low-margin payload bits counts payload bits whose repetition votes were close to a tie. More precisely, it counts bits where the margin between the winning and losing vote counts was less than 20% of the total. It is a rough confidence indicator and plays no role in decoding.

In this comparison, Δ=25 performed better: it produced a successful decode where Δ=20 did not. A larger coefficient separation makes the embedded states harder to confuse after image processing, but may also increase distortion. These results support choosing Δ=25 for the tested configuration, not claiming it is universally optimal.

<a id="93-visual-quality-and-the-cross-hatch-effect"></a>

#### 9.3. Visual quality and the cross-hatch effect
After the earlier Δ=25 configuration succeeded with 25× header repetition and 30× payload repetition, I tested someone's suggestion to increase the coefficient margin further. The goal was to see whether a wider margin could make each embedded observation more resilient and allow the system to use fewer repetitions.

With `Δ=35`, the image did not show readily noticeable visual distortions during an initial inspection. I then reduced payload repetition from 30× to 20× and header repetition from 25× to 15×, testing the largest message each configuration could carry. The 30×/25× configuration carried the 35-byte message from §9.2; the final 20×/15× configuration carried 60 bytes.

A larger coefficient margin allowed a lower repetition budget without breaking the round-trip. It does not by itself prove that Δ=35 is optimal, or that the same settings will work on other images or processing pipelines. 

A closer inspection of the final configuration revealed a recurring visual artifact in darker and black regions: a **cross-hatch effect**. When zoomed in, these regions exhibited a fine, repeating texture resembling a mesh of small, block-like elements. The pattern appeared relatively dense, with few visible gaps between adjacent elements. Compared with the earlier Δ=25 result, the gaps between these patches appeared larger at Δ=25 than at Δ=35. The pattern also appeared darker and visually uniform at Δ=35.
<div class="table-scroll">
  <table>
    <tbody>
      <tr>
        <td>
          <img src="/writeup-assets/2026/steg/1-original.jpg" alt="Original image 1" width="100%">
          <p align="center">Original Image</p>
          <img src="/writeup-assets/2026/steg/2-original.jpg" alt="Original image 2" width="100%">
          <p align="center">Original Image</p>
        </td>
        <td>
          <img src="/writeup-assets/2026/steg/1.png" alt="Image 1 encoded with Delta 35" width="100%">
          <p align="center">Δ=35</p>
          <img src="/writeup-assets/2026/steg/2.png" alt="Image 2 encoded with Delta 35" width="100%">
          <p align="center">Δ=35</p>
        </td>
      </tr>
      <tr>
        <td>
          <img src="/writeup-assets/2026/steg/2-original-closeup.png" alt="Original close-up without cross-hatch effect" width="100%">
          <p align="center">Original - Close-up (No Cross-hatch Effect)</p>
           <img src="/writeup-assets/2026/steg/2-comparison-closeup-d25.png" alt="Cross-hatch effect with Delta 25" width="100%">
          <p align="center">Δ=25 - Cross-hatch Effect</p>
        </td>
        <td>
          <img src="/writeup-assets/2026/steg/2-closeup.png" alt="Delta 35 close-up showing cross-hatch effect" width="100%">
          <p align="center">Δ=35 - Close-up (Cross-hatch Effect)</p>
          <img src="/writeup-assets/2026/steg/2-comparison-closeup-d35.png" alt="Cross-hatch effect with Delta 35" width="100%">
          <p align="center">Δ=35 - Cross-hatch Effect</p>
        </td>
      </tr>
    </tbody>
  </table>
</div>

<a id="94-carrier-dimensions-are-part-of-synchronization"></a>

#### 9.4. Carrier dimensions are part of synchronization
A separate failure showed that matching the embedding parameters isn't enough. The encoder and decoder must also agree on the image's block geometry.

The block permutation is generated from a list of available blocks. A fixed seed reproduces the same permutation only when both sides construct lists of the same size.

One test began with a 1254×1254 image. That image contains 156 complete 8×8 blocks per dimension:
```text
156 * 156 = 24,336 blocks
```

After Discord processing, the image was returned at 1024×1024, which contains:
```text
128 * 128 = 16,384 blocks
```

The encoder and decoder were therefore working with different block populations. Applying the same public seed to lists of different sizes did not recreate the same mapping. The decoder read from physical blocks that did not correspond to the encoder's selected locations, and the header was corrupted.

The solution was to normalize the carrier before embedding:
```python
if im.size != (1024, 1024):
    im = im.resize((1024, 1024), Image.Resampling.LANCZOS)
```

A subsequent test with a normalized carrier decoded successfully. In this system, image dimensions are part of synchronization, not merely a preprocessing choice.

<a id="95-capacity-and-the-cost-of-robustness"></a>

#### 9.5. Capacity and the cost of robustness
The carrier contains 16,384 blocks, but error correction and repetition consume most of them.

The 10-byte header contains 80 information bits. BCH(31,21) encodes these into four 31-bit codewords, or 124 coded bits. With 15× repetition, the header occupies 1,860 blocks, leaving 14,524 blocks for the payload.

```text
Header blocks = 4 × 31 × 15 = 1,860
Remaining blocks = 16,384 − 1,860 = 14,524

Payload BCH codewords = floor(14,524 / (31 × 20))
                      = 23

Payload information capacity = 23 × 21 = 483 bits
                              = 60 complete bytes, with padding
```

Each BCH codeword carries 21 information bits. Since the encoder pads the final codeword when necessary, a 60-byte message fit within 23 codewords. A 60-byte payload contains 480 information bits and therefore fits within the available 483 information bits.

For a 60-byte message, the payload uses 23 BCH codewords, repeated 20×:

```text
Payload blocks = 23 × 31 × 20 = 14,260
Header blocks  = 4 × 31 × 15 =  1,860
Total used                      = 16,120
Blocks available                = 16,384
Unused blocks                   =    264
```

I successfully encoded and decoded a 60-byte UTF-8 message with this configuration. The decoder reported zero corrected or uncorrectable codewords for both the header and payload, and zero low-margin payload bits out of 713 coded payload bits.

Thus, **60 bytes** is the largest payload demonstrated successfully so far with these repetition factors. The block-budget calculation also indicates that 60 bytes is the maximum whole-byte payload under the current block budget that fits within the 23 available BCH codewords. 

This capacity reflects a deliberate tradeoff. BCH adds parity, repetition adds observations, and shuffling and interleaving help distribute errors. As noted in §4.2, the 75× repetition experiment used 16,200 blocks for a 216-bit raw payload alone, leaving almost no room for the header. The final configuration favors recovery of short messages over payload size.

<a id="96-what-the-experiment-does-and-does-not-show"></a>

#### 9.6. What the experiment does and does not show
The successful round-trip demonstrates recovery through the specific Discord profile-picture processing path tested. It does not establish universal robustness.

* **Channel dependence**: other image platforms and processing pipelines may produce different results.
* **Empirical parameters**: the coefficient pair and Δ=35 were selected for this experiment, not proven optimal for all carriers.
* **Limited capacity**: the 60-byte payload follows from the chosen error-correction and repetition settings.
* **No secrecy**: the system uses neither encryption nor a secret key. Anyone who knows the method and parameters may be able to decode the message.
* **Limited evaluation**: broader reliability claims require repeated tests across different carrier images and processing conditions, ideally measuring both recovery rate and visual distortion.

These limitations define what the experiment demonstrates: a successful recovery under one tested configuration, not a general guarantee for arbitrary images or channels.

<a id="10-what-we-learned"></a>

### 10. What we learned

The biggest lesson from this project was that embedding the message was the easy part. Getting it back after Discord processed the image took much more work.

LSB embedding failed because the channel changed pixel values. Moving to DCT coefficient differences helped, but didn't eliminate errors. Repetition, BCH coding, interleaving, and block shuffling each addressed a different part of the problem. We also learned that details outside the embedding algorithm, such as matching the image dimensions, could break decoding just as effectively as corrupted bits.

The final configuration recovered short messages through the Discord workflow we tested, but it comes with clear tradeoffs: limited payload capacity, some image distortion, and no secrecy. It also hasn't been tested across enough images and processing conditions to claim general reliability. Only around 10 unique images were tested.

For this particular use case, 60 bytes was enough. The goal wasn't to build a general-purpose steganography system; it really was to find a configuration that could survive one specific image-processing pipeline and recover a short message afterward.

<a id="steganography-is-not-encryption"></a>

#### Steganography is not encryption
This implementation does not encrypt the payload or use a secret key. The public shuffle seed only ensures that the encoder and decoder use the same block ordering. Anyone who knows the embedding method and its parameters may be able to recover the message.

Steganography hides information within a carrier; encryption makes the information unreadable without the required key. This project explores the first problem, not the second.

<a id="source-code"></a>

### Source code
The implementation used for these experiments is available on GitHub:

[**github.com/wqsv/stego**](https://github.com/wqsv/stego)

The repository contains the encoder and decoder associated with the experiments described in this article. Star the repo if you found this article interesting :P