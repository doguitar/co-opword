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

const sundayRows = [
  ".....#...##...##.....",
  ".....#.........#.....",
  ".....#.........#.....",
  ".....#.........#.....",
  ".....#.........##....",
  "#####################",
  ".....#.........#.....",
  ".....#.........#.....",
  ".....#.........#.....",
  "...###.....#...#.....",
  "....##.........##....",
  ".....#...#.....###...",
  ".....#.........#.....",
  ".....#.........#.....",
  ".....#.........#.....",
  "#####################",
  "....##.........#.....",
  ".....#.........#.....",
  ".....#.........#.....",
  ".....#.........#.....",
  ".....##...##...#.....",
];

function sundaySheet(): LibraryCrosswordInput {
  const size = sundayRows.length;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const squares = sundayRows.flatMap((row, rowIndex) =>
    [...row].map((cell, column) => (cell === "#" ? "#" : alphabet[(rowIndex + column) % alphabet.length])),
  );
  const words: LibraryCrosswordInput["words"] = [];
  const answerAt = (row: number, column: number, length: number, direction: "across" | "down") =>
    Array.from({ length }, (_, offset) => squares[(row + (direction === "down" ? offset : 0)) * size + column + (direction === "across" ? offset : 0)]).join("");
  for (let row = 0; row < size; row++) {
    let column = 0;
    while (column < size) {
      if (squares[row * size + column] === "#") {
        column += 1;
        continue;
      }
      const start = column;
      while (column < size && squares[row * size + column] !== "#") column += 1;
      words.push({ direction: "across", row, column: start, answer: answerAt(row, start, column - start, "across"), clue: "Across entry" });
    }
  }
  for (let column = 0; column < size; column++) {
    let row = 0;
    while (row < size) {
      if (squares[row * size + column] === "#") {
        row += 1;
        continue;
      }
      const start = row;
      while (row < size && squares[row * size + column] !== "#") row += 1;
      words.push({ direction: "down", row: start, column, answer: answerAt(start, column, row - start, "down"), clue: "Down entry" });
    }
  }
  return { title: "Sunday Sheet", kind: "standard", size, squares, words };
}

export const librarySeed: LibraryCrosswordInput[] = [
  { title: "Filled Fifteen", kind: "standard", size: 15, squares: letters(15), words: bothWays(15) },
  sundaySheet(),
  {
    title: "First Row",
    kind: "freestyle",
    size: 9,
    squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
    words: [{ direction: "across", row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
  },
];
