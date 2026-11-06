const spread = document.querySelector(".spread");
const toggle = document.getElementById("menu-toggle");
const menu = document.getElementById("menu");
const leaf = document.querySelector(".spread > .leaf");

if (spread instanceof HTMLElement && toggle instanceof HTMLButtonElement && menu instanceof HTMLElement && leaf instanceof HTMLElement) {
  let open = false;
  let lastFocus = null;

  const setOpen = (next) => {
    open = next;
    spread.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Close" : "Menu";
    menu.inert = !open;
    leaf.inert = open;
  };

  toggle.addEventListener("click", () => {
    if (!open) {
      lastFocus = document.activeElement;
      setOpen(true);
      const link = menu.querySelector("a");
      if (link instanceof HTMLElement) link.focus();
    } else {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    (lastFocus instanceof HTMLElement ? lastFocus : toggle).focus();
  });
}
