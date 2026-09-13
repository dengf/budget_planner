# OCR model attribution

## PP-OCRv6_tiny (detection + recognition)

Files: `www/static/ocr/ppocrv6-tiny-det.rten`,
`www/static/ocr/ppocrv6-tiny-rec.rten`,
`crates/budget-calc/assets/ppocrv6_tiny_alphabet.json`.

These are derived from PaddleOCR's PP-OCRv6_tiny detection and
recognition models, converted to the `.rten` format for use with the
`rten`/`ocrs-cjk` runtime (see `crates/budget-calc/src/ocr.rs`).

PaddleOCR is:

> Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
>
> Licensed under the Apache License, Version 2.0 (the "License");
> you may not use this file except in compliance with the License.
> You may obtain a copy of the License at
>
>     http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS,
> WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
> See the License for the specific language governing permissions and
> limitations under the License.

Source: <https://github.com/PaddlePaddle/PaddleOCR>

**Modification from the original:** the PP-OCRv6_tiny detection and
recognition ONNX weights were converted to the `.rten` model format
(no change to model architecture or trained weights) for use with the
pure-Rust `rten` inference runtime.

The full Apache License 2.0 text is included in
`RUST-THIRD-PARTY-LICENSES.html` alongside every other Apache-2.0
component this app uses.
