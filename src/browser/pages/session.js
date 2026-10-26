const scrollKey = "session-scroll";
for (const id of ["select-square", "type-letter", "clear-square"]) {
  document.getElementById(id)?.addEventListener("submit", () => {
    sessionStorage.setItem(scrollKey, String(window.scrollY));
  });
}
const savedScroll = sessionStorage.getItem(scrollKey);
if (savedScroll !== null) sessionStorage.removeItem(scrollKey);
const place = () => {
  if (savedScroll !== null) window.scrollTo(0, Number(savedScroll));
  const selected = document.querySelector(".grid td.selected button");
  if (selected instanceof HTMLButtonElement) selected.focus({ preventScroll: true });
};
place();
window.addEventListener("load", place);

const inviteDialog = document.getElementById("invite-players");
document.getElementById("open-invite")?.addEventListener("click", () => {
  if (inviteDialog instanceof HTMLDialogElement) inviteDialog.showModal();
});
document.getElementById("close-invite")?.addEventListener("click", () => {
  if (inviteDialog instanceof HTMLDialogElement) inviteDialog.close();
});

const copyInvite = document.getElementById("copy-invite");
const copied = document.getElementById("invite-copied");
copyInvite?.addEventListener("click", () => {
  if (!(copyInvite instanceof HTMLButtonElement)) return;
  const link = new URL(copyInvite.dataset.inviteLink ?? "", location.href).href;
  navigator.clipboard.writeText(link).then(() => {
    copied?.classList.add("show");
    window.setTimeout(() => copied?.classList.remove("show"), 1600);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
    const selected = document.querySelector(".grid td.selected button");
    const grid = document.querySelector(".grid");
    const width = grid?.querySelector("tr")?.children.length ?? 0;
    if (!(selected instanceof HTMLButtonElement) || width === 0) return;
    const cells = [...grid.querySelectorAll("td")];
    const start = Number(selected.value);
    const across = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    let cursor = start;
    event.preventDefault();
    while (true) {
      if (across) {
        const row = Math.floor(cursor / width);
        cursor += step;
        if (cursor < row * width || cursor >= (row + 1) * width) return;
      } else {
        cursor += step * width;
        if (cursor < 0 || cursor >= cells.length) return;
      }
      const button = cells[cursor]?.querySelector("button");
      if (button instanceof HTMLButtonElement) {
        button.click();
        return;
      }
    }
  }
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
