document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (event.key === "Backspace" || event.key === "Delete") {
    const clear = document.getElementById("clear-square");
    const index = clear?.querySelector("[name=index]");
    if (!(clear instanceof HTMLFormElement) || !(index instanceof HTMLInputElement) || index.value === "") return;
    event.preventDefault();
    clear.requestSubmit();
    return;
  }
  if (!/^[a-zA-Z]$/.test(event.key)) return;
  const form = document.getElementById("type-letter");
  const letter = form?.querySelector("[name=letter]");
  if (!(form instanceof HTMLFormElement) || !(letter instanceof HTMLInputElement)) return;
  event.preventDefault();
  letter.value = event.key;
  form.requestSubmit();
});
