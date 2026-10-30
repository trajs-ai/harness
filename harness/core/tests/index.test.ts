import { expect, it } from "vite-plus/test";

import * as Harness from "#/index.ts";

it("exports no public module yet", () => {
  expect(Object.keys(Harness)).toEqual([]);
});
