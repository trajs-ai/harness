import { expect, it } from "vite-plus/test";

import * as HarnessDurable from "#/index.ts";

it("exports no public module yet", () => {
  expect(Object.keys(HarnessDurable)).toEqual([]);
});
