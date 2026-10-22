import assert from "node:assert/strict";
import { test } from "node:test";
import { DisplayNameTaken, openCoOpword } from "./coopword.ts";

test("a magic link to a new email creates a Player and signs them in, and a later link to that email signs the same Player in", () => {
  const coOpword = openCoOpword();

  const firstLink = coOpword.requestMagicLink("Ada@Example.com");
  const firstSession = coOpword.openMagicLink(firstLink.token);

  assert.deepEqual(coOpword.whoAmI(firstSession), { displayName: null });

  coOpword.chooseDisplayName(firstSession, "Ada");

  const returnLink = coOpword.requestMagicLink("ada@example.com");
  const returnSession = coOpword.openMagicLink(returnLink.token);

  assert.deepEqual(coOpword.whoAmI(returnSession), { displayName: "Ada" });
  assert.deepEqual(coOpword.whoAmI(firstSession), { displayName: "Ada" });
});

test("a display name already taken, ignoring capitals, is rejected", () => {
  const coOpword = openCoOpword();
  const sam = coOpword.openMagicLink(coOpword.requestMagicLink("sam@example.com").token);
  coOpword.chooseDisplayName(sam, "Sam");

  const other = coOpword.openMagicLink(coOpword.requestMagicLink("other@example.com").token);

  assert.throws(() => coOpword.chooseDisplayName(other, "sam"), DisplayNameTaken);
  assert.deepEqual(coOpword.whoAmI(other), { displayName: null });
  assert.deepEqual(coOpword.playersOthersSee(other), [{ displayName: "Sam" }]);
});

test("renaming frees the old name, and other Players see the new display name rather than the email", () => {
  const coOpword = openCoOpword();
  const sam = coOpword.openMagicLink(coOpword.requestMagicLink("sam@example.com").token);
  coOpword.chooseDisplayName(sam, "Sam");

  const other = coOpword.openMagicLink(coOpword.requestMagicLink("other@example.com").token);

  coOpword.chooseDisplayName(sam, "Samuel");

  assert.deepEqual(coOpword.playersOthersSee(other), [{ displayName: "Samuel" }]);
  assert.deepEqual(coOpword.whoAmI(other), { displayName: null });

  coOpword.chooseDisplayName(other, "Sam");
  assert.deepEqual(coOpword.whoAmI(other), { displayName: "Sam" });
  assert.deepEqual(coOpword.playersOthersSee(sam), [{ displayName: "Sam" }]);
});

test("closing the browser and opening it again returns the same Player", () => {
  const coOpword = openCoOpword();
  const session = coOpword.openMagicLink(coOpword.requestMagicLink("ada@example.com").token);
  coOpword.chooseDisplayName(session, "Ada");

  const reopened = openCoOpword(coOpword.snapshot());

  assert.deepEqual(reopened.whoAmI(session), { displayName: "Ada" });

  const again = reopened.openMagicLink(reopened.requestMagicLink("ada@example.com").token);
  assert.deepEqual(reopened.whoAmI(again), { displayName: "Ada" });
});
