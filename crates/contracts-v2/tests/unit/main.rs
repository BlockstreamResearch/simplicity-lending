//! Unit tests of the SimplicityHL helpers, run off the chain.
//!
//! Each helper module under `simf/` has a test program at the same path under `simf/tests/`.
//! A program takes one case per witness, as a branch of `CASE` for each function it covers,
//! and asserts the function's result against the expected value in the case.

mod support;

mod protocol_fee;
