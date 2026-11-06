import assert from "node:assert/strict";
import { test } from "node:test";
import { clueNumbers, mirrorBlockValue } from "./build.js";

// Shared Across/Down start at A. # ends runs. The lower-left dot is white
// but a singleton both ways, so it stays unnumbered. Dots and letters are white.
// A B # .
// C # # .
// # . D E
// . # F .
test("clueNumbers numbers the union of across and down starts in row-major order", () => {
  const squares = [
    "A", "B", "#", ".",
    "C", "#", "#", ".",
    "#", ".", "D", "E",
    ".", "#", "F", ".",
  ];
  assert.deepEqual(clueNumbers(squares, 4), [
    "1", "", "", "2",
    "", "", "", "",
    "", "3", "4", "",
    "", "", "5", "",
  ]);
});

test("mirrorBlockValue mirrors black squares without copying answer letters", () => {
  assert.equal(mirrorBlockValue("#", "A"), "#");
  assert.equal(mirrorBlockValue("A", "#"), "");
  assert.equal(mirrorBlockValue("A", "B"), "B");
  assert.equal(mirrorBlockValue("#", "#"), "#");
});
