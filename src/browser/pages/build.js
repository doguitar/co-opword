/** Row-major numbers for cells that start an Across or Down run of at least two. */
export function clueNumbers(squares, size) {
  const isBlack = (index) => squares[index] === "#";
  const starts = new Set();
  for (let row = 0; row < size; row += 1) {
    let column = 0;
    while (column < size) {
      while (column < size && isBlack(row * size + column)) column += 1;
      const start = column;
      while (column < size && !isBlack(row * size + column)) column += 1;
      if (column - start >= 2) starts.add(row * size + start);
    }
  }
  for (let column = 0; column < size; column += 1) {
    let row = 0;
    while (row < size) {
      while (row < size && isBlack(row * size + column)) row += 1;
      const start = row;
      while (row < size && !isBlack(row * size + column)) row += 1;
      if (row - start >= 2) starts.add(start * size + column);
    }
  }
  const numbers = Array.from({ length: size * size }, () => "");
  let number = 0;
  for (let index = 0; index < numbers.length; index += 1) {
    if (!starts.has(index)) continue;
    number += 1;
    numbers[index] = String(number);
  }
  return numbers;
}

export function mirrorBlockValue(value, oppositeValue) {
  if (value === "#") return "#";
  return oppositeValue === "#" ? "" : oppositeValue;
}

function editableSquares(form) {
  return [...form.querySelectorAll('.grid input[name="square"]')].filter((input) =>
    input instanceof HTMLInputElement && input.type !== "hidden" && !input.readOnly && !input.disabled,
  );
}

function paint(input) {
  input.closest("td")?.classList.toggle("block", input.value === "#");
}

function renumber(form) {
  const inputs = editableSquares(form);
  const row = form.querySelector(".grid tr");
  const size = row instanceof HTMLTableRowElement ? row.cells.length : 0;
  if (size < 1 || inputs.length !== size * size) return;
  const numbers = clueNumbers(inputs.map((input) => input.value), size);
  for (let index = 0; index < inputs.length; index += 1) {
    const marker = inputs[index].closest("td")?.querySelector(".number");
    if (marker) marker.textContent = numbers[index];
  }
}

function squareInput(target) {
  if (!(target instanceof Element)) return null;
  const input = target.closest("td")?.querySelector('input[name="square"]');
  if (!(input instanceof HTMLInputElement)) return null;
  if (input.type === "hidden" || input.readOnly || input.disabled) return null;
  if (!input.closest(".grid")) return null;
  return input;
}


function bindStandardRules(form) {
  const kind = form.querySelector('select[name="kind"]');
  const rules = form.querySelector("[data-standard-rules]");
  if (!(kind instanceof HTMLSelectElement) || !(rules instanceof HTMLElement)) return;
  const update = () => {
    rules.hidden = kind.value !== "standard";
  };
  kind.addEventListener("change", update);
  update();
}

function mirrorBlock(form, input) {
  if (
    form.dataset.buildStep !== "grid" ||
    form.querySelector('select[name="kind"]')?.value !== "standard"
  ) return;
  const inputs = editableSquares(form);
  const index = inputs.indexOf(input);
  const opposite = inputs[inputs.length - 1 - index];
  if (index < 0 || !opposite || opposite === input) return;
  opposite.value = mirrorBlockValue(input.value, opposite.value);
  paint(opposite);
}

function bind(form) {
  form.addEventListener("contextmenu", (event) => {
    const input = squareInput(event.target);
    if (!input) return;
    event.preventDefault();
    input.value = input.value === "#" ? "" : "#";
    mirrorBlock(form, input);
    paint(input);
    renumber(form);
  });
  form.addEventListener("input", (event) => {
    const input = squareInput(event.target);
    if (!input) return;
    mirrorBlock(form, input);
    paint(input);
    renumber(form);
  });
  for (const input of editableSquares(form)) paint(input);
  renumber(form);
}

function bindClues(form) {
  for (const item of form.querySelectorAll("[data-build-clue]")) {
    const display = item.querySelector("[data-build-clue-display]");
    const text = item.querySelector("[data-clue-text]");
    const editor = item.querySelector("[data-build-clue-editor]");
    if (!(display instanceof HTMLButtonElement) || !(text instanceof HTMLSpanElement) || !(editor instanceof HTMLTextAreaElement)) {
      continue;
    }
    const finish = () => {
      text.textContent = editor.value;
      editor.hidden = true;
      display.hidden = false;
    };
    display.addEventListener("click", () => {
      display.hidden = true;
      editor.hidden = false;
      editor.focus();
    });
    editor.addEventListener("blur", finish);
    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      finish();
      display.focus({ preventScroll: true });
    });
  }
}
if (typeof document !== "undefined") {
  for (const form of document.querySelectorAll("form.build")) {
    if (form.dataset.buildStep !== "edit") bindStandardRules(form);
    if (form.dataset.buildStep === "grid" || form.dataset.buildStep === "edit") bind(form);
    if (form.dataset.buildStep === "clues") bindClues(form);
  }
}
