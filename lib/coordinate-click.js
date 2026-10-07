export function validateClickTarget({
  ref,
  selector,
  coordinates,
  doubleClick,
}) {
  if (
    [ref, selector, coordinates].filter(
      (v) => v !== undefined && v !== null && v !== "",
    ).length !== 1
  ) {
    throw Object.assign(
      new Error("Supply exactly one of ref, selector, or coordinates"),
      { statusCode: 400, code: "invalid_click_target" },
    );
  }
  if (doubleClick !== undefined && typeof doubleClick !== "boolean")
    throw Object.assign(new Error("doubleClick must be boolean"), {
      statusCode: 400,
    });
  if (
    coordinates &&
    (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y))
  )
    throw Object.assign(new Error("coordinates must contain finite x and y"), {
      statusCode: 400,
    });
}
export async function coordinateClick(page, coordinates, doubleClick = false) {
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const { x, y } = coordinates;
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height)
    throw Object.assign(new Error("Coordinates outside the visible viewport"), {
      statusCode: 400,
      code: "invalid_coordinates",
    });
  await page.mouse.click(x, y, { clickCount: doubleClick ? 2 : 1 });
}
