import type { LibraryCrosswordInput } from "../product/coopword.ts";

function letters(size: number): string[] {
  return Array.from({ length: size * size }, () => "A");
}

function bothWays(size: number): LibraryCrosswordInput["words"] {
  const words: LibraryCrosswordInput["words"] = [];
  for (let index = 0; index < size; index++) {
    const answer = "A".repeat(size);
    words.push({ direction: "across", row: index, column: 0, answer, clue: `Across ${index + 1}` });
    words.push({ direction: "down", row: 0, column: index, answer, clue: `Down ${index + 1}` });
  }
  return words;
}

export const librarySeed: LibraryCrosswordInput[] = [
  { title: "Filled Fifteen", kind: "standard", size: 15, squares: letters(15), words: bothWays(15) },
  {
    title: "First Row",
    kind: "freestyle",
    size: 9,
    squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
    words: [{ direction: "across", row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
  },
];
