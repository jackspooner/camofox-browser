import { setTimeout as delay } from "node:timers/promises";
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const textUnits = (text) =>
  [...segmenter.segment(text)].map((x) => x.segment);
const invalid = (detail) =>
  Object.assign(new Error(detail), {
    code: "invalid_request",
    statusCode: 400,
  });
const changed = (code, detail) =>
  Object.assign(new Error(detail), { code, statusCode: 409 });
export function typingBudget({ text, wpm = 150, append = false } = {}) {
  if (typeof text !== "string") throw invalid("text must be a string");
  if (!text.isWellFormed() || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(text))
    throw invalid(
      "Paced text must contain valid Unicode and no control characters other than LF",
    );
  if (!Number.isFinite(wpm) || wpm < 30 || wpm > 300)
    throw invalid("wpm must be between 30 and 300");
  if (typeof append !== "boolean") throw invalid("append must be boolean");
  const units = textUnits(text),
    expectedMs = (units.length * 60000) / (wpm * 5);
  const budgetMs = Math.ceil(Math.max(30000, 2 * expectedMs + 10000));
  if (budgetMs > 600000)
    throw invalid(
      "Paced text exceeds the ten-minute action budget; split it before submitting",
    );
  return { units, wpm, append, expectedMs, budgetMs };
}
export function cadence(units, wpm, random = Math.random) {
  const weights = units.map(
    (c) => (0.65 + random() * 0.7) * (/[.!?,;:]$/.test(c) ? 1.4 : 1),
  );
  const mean = weights.reduce((a, b) => a + b, 0) / (weights.length || 1);
  return weights.map((w) => ((w / mean) * 60000) / (wpm * 5));
}
export async function pacedType(
  page,
  locator,
  options,
  signal,
  report = () => {},
) {
  const { units, wpm, append } = typingBudget(options);
  if ((await locator.count()) !== 1)
    throw changed(
      "ambiguous_target",
      "Paced typing requires one editable target",
    );
  const handle = await locator.elementHandle();
  if (!handle) throw changed("target_changed", "Typing target disappeared");
  const frame = await handle.ownerFrame();
  let navigated = false;
  const onNavigation = (f) => {
    if (f === frame) navigated = true;
  };
  page.on("framenavigated", onNavigation);
  const read = () =>
    handle.evaluate((el) => ({
      connected: el.isConnected,
      editable:
        !el.disabled &&
        !el.readOnly &&
        (el.isContentEditable ||
          el.tagName === "TEXTAREA" ||
          (el.tagName === "INPUT" &&
            ["text", "search", "email", "url", "tel", "password"].includes(
              el.type,
            ))),
      multiline: el.isContentEditable || el.tagName === "TEXTAREA",
      focused:
        el === el.ownerDocument.activeElement ||
        el.contains(el.ownerDocument.activeElement),
      value: el.isContentEditable ? el.innerText : el.value,
    }));
  const guard = async (focus = true) => {
    signal.throwIfAborted();
    if (navigated || frame?.isDetached())
      throw changed("target_changed", "Typing document changed");
    let state;
    try {
      state = await read();
    } catch {
      throw changed("target_changed", "Typing target disappeared");
    }
    if (!state.connected || !state.editable)
      throw changed("target_changed", "Typing target is no longer editable");
    if (focus && !state.focused)
      throw changed(
        "focus_changed",
        "Typing focus moved; inspect the field before continuing",
      );
    return state;
  };
  try {
    const initial = await guard(false);
    if (
      options.text.includes("\r") ||
      (!initial.multiline && options.text.includes("\n"))
    )
      throw invalid(
        "This field cannot preserve the requested newline characters",
      );
    await handle.focus();
    await guard();
    if (!append) {
      await handle.fill("");
      await guard();
    } else {
      await handle.evaluate((el) => {
        if (el.isContentEditable) {
          const r = el.ownerDocument.createRange();
          r.selectNodeContents(el);
          r.collapse(false);
          const s = el.ownerDocument.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        } else if (el.type !== "email")
          el.setSelectionRange(el.value.length, el.value.length);
      });
      if (await handle.evaluate((el) => el.type === "email"))
        await handle.press("End");
    }
    const start = performance.now(),
      intervals = cadence(units, wpm);
    const progress = (completed) =>
      report({
        completed,
        total: units.length,
        elapsedMs: Math.round(performance.now() - start),
        mode: "paced",
        wpm,
      });
    progress(0);
    for (let i = 0; i < units.length; i++) {
      await guard();
      const began = performance.now();
      if (units[i] === "\n") await page.keyboard.press("Enter");
      else await page.keyboard.type(units[i], { delay: 0 });
      await guard();
      progress(i + 1);
      if (i < units.length - 1)
        await delay(
          Math.max(0, intervals[i] - (performance.now() - began)),
          undefined,
          { signal },
        );
    }
    const final = await guard();
    if (final.value !== (append ? initial.value : "") + options.text)
      throw changed(
        "typing_mismatch",
        "The application transformed the text; inspect the field before another action",
      );
    if (options.pressEnter) {
      await guard();
      await page.keyboard.press("Enter");
    }
    progress(units.length);
    return {
      mode: "paced",
      wpm,
      completed: units.length,
      total: units.length,
      elapsedMs: Math.round(performance.now() - start),
    };
  } finally {
    page.removeListener("framenavigated", onNavigation);
    await handle.dispose();
  }
}
