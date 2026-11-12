// Copyright 2024-2026 Buf Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from "node:assert/strict";
import { suite, test } from "node:test";
import { create, type DescMessage } from "@bufbuild/protobuf";
import { buildPath } from "@bufbuild/protobuf/reflect";
import {
  DurationRulesSchema,
  TimestampRulesSchema,
} from "../gen/buf/validate/validate_pb.js";
import { assertRuleIdOrder, compile, diff } from "./testing.js";
import { tryBuildNativeTimeRules } from "./time.js";

const preamble = `
  import "google/protobuf/duration.proto";
  import "google/protobuf/timestamp.proto";
`;

function ts(seconds: bigint, nanos = 0) {
  return { seconds, nanos };
}

// Validate `values` as field `t` of M under both paths.
function diffAll(s: DescMessage, values: { seconds: bigint; nanos: number }[]) {
  for (const t of values) {
    diff(s, create(s, { t }));
  }
}

void suite("native timestamp rules", () => {
  const compileTs = (rules: string) =>
    compile(
      `message M { google.protobuf.Timestamp t = 1 [(buf.validate.field).timestamp = { ${rules} }]; }`,
      { preamble },
    );
  const values = [
    ts(-1n, 999_999_999),
    ts(0n),
    ts(0n, 1),
    ts(9n, 999_999_999),
    ts(10n),
    ts(10n, 1),
    ts(11n),
    ts(1_700_000_000n, 123_000_000),
  ];

  void test("const", () => {
    diffAll(compileTs("const: { seconds: 10 }"), values);
  });

  void test("single bounds", () => {
    for (const rules of [
      "gt: { seconds: 10 }",
      "gte: { seconds: 10 }",
      "lt: { seconds: 10 }",
      "lte: { seconds: 10 }",
      "gt: { seconds: 0, nanos: 1 }",
      "lt: { seconds: -1, nanos: 999999999 }",
    ]) {
      diffAll(compileTs(rules), values);
    }
  });

  void test("ranges", () => {
    for (const rules of [
      "gt: { seconds: 0 }, lt: { seconds: 10 }",
      "gt: { seconds: 0 }, lte: { seconds: 10 }",
      "gte: { seconds: 0 }, lt: { seconds: 10 }",
      "gte: { seconds: 0 }, lte: { seconds: 10 }",
      "gt: { seconds: 10 }, lt: { seconds: 0 }",
      "gt: { seconds: 10 }, lte: { seconds: 0 }",
      "gte: { seconds: 10 }, lt: { seconds: 0 }",
      "gte: { seconds: 10 }, lte: { seconds: 0 }",
      "gte: { seconds: 10 }, lte: { seconds: 10 }",
    ]) {
      diffAll(compileTs(rules), values);
    }
  });

  void test("const is reported before the range", () => {
    const s = compileTs("const: { seconds: 5 }, gt: { seconds: 10 }");
    assertRuleIdOrder(s, create(s, { t: ts(1n) }), [
      "timestamp.const",
      "timestamp.gt",
    ]);
  });

  void test("values that are not valid timestamps", () => {
    diffAll(compileTs("gt: { seconds: 0 }, lt: { seconds: 10 }"), [
      ts(5n, -1),
      ts(5n, 1_000_000_000),
      ts(-62_135_596_801n),
      ts(253_402_300_800n),
    ]);
  });

  void test("fixed bounds are handled natively", () => {
    const rules = create(TimestampRulesSchema, {
      const: { seconds: 1n },
      greaterThan: { case: "gt", value: { seconds: 0n } },
      lessThan: { case: "lte", value: { seconds: 2n } },
    });
    const result = tryBuildNativeTimeRules(
      rules,
      buildPath(TimestampRulesSchema),
      false,
    );
    assert.deepEqual(
      new Set(result?.handledFields),
      new Set([
        TimestampRulesSchema.field.const,
        TimestampRulesSchema.field.gt,
        TimestampRulesSchema.field.lte,
      ]),
    );
  });

  void test("rules relative to now are left to CEL", () => {
    const path = buildPath(TimestampRulesSchema);
    for (const init of [
      { lessThan: { case: "ltNow", value: true } },
      { greaterThan: { case: "gtNow", value: true } },
      { within: { seconds: 60n } },
    ] as const) {
      const rules = create(TimestampRulesSchema, init);
      assert.equal(tryBuildNativeTimeRules(rules, path, false), undefined);
    }
  });

  void test("bounds that cannot be formatted are left to CEL", () => {
    const rules = create(TimestampRulesSchema, {
      greaterThan: { case: "gt", value: { seconds: 0n, nanos: -1 } },
    });
    assert.equal(
      tryBuildNativeTimeRules(rules, buildPath(TimestampRulesSchema), false),
      undefined,
    );
  });

  void test("repeated items and map values", () => {
    const s = compile(
      `message M {
        repeated google.protobuf.Timestamp list = 1 [(buf.validate.field).repeated.items.timestamp.gt = { seconds: 5 }];
        map<string, google.protobuf.Timestamp> map = 2 [(buf.validate.field).map.values.timestamp.lt = { seconds: 5 }];
      }`,
      { preamble },
    );
    diff(
      s,
      create(s, {
        list: [ts(1n), ts(6n), ts(5n)],
        map: { a: ts(1n), b: ts(6n) },
      }),
    );
  });
});

void suite("native duration rules", () => {
  const compileDur = (rules: string) =>
    compile(
      `message M { google.protobuf.Duration t = 1 [(buf.validate.field).duration = { ${rules} }]; }`,
      { preamble },
    );
  const values = [
    ts(-10n),
    ts(-1n, -500_000_000),
    ts(0n),
    ts(0n, 500_000_000),
    ts(1n),
    ts(60n),
    ts(60n, 1),
  ];

  void test("const, in and not_in", () => {
    diffAll(compileDur("const: { seconds: 1 }"), values);
    diffAll(
      compileDur(
        "in: [{ seconds: 1 }, { nanos: 500000000 }], not_in: [{ seconds: -10 }]",
      ),
      values,
    );
  });

  void test("bounds and ranges", () => {
    for (const rules of [
      "gt: { seconds: 0 }",
      "gte: { seconds: 1 }",
      "lt: { seconds: 60 }",
      "lte: { seconds: 60 }",
      "gte: { seconds: 1 }, lte: { seconds: 60 }",
      "gt: { seconds: 60 }, lt: { seconds: 0 }",
      "gt: { seconds: -1, nanos: -500000000 }, lt: { nanos: 500000000 }",
    ]) {
      diffAll(compileDur(rules), values);
    }
  });

  void test("rule order follows validate.proto", () => {
    const s = compileDur(
      "const: { seconds: 2 }, gt: { seconds: 5 }, in: [{ seconds: 3 }], not_in: [{ seconds: 1 }]",
    );
    assertRuleIdOrder(s, create(s, { t: ts(1n) }), [
      "duration.const",
      "duration.gt",
      "duration.in",
      "duration.not_in",
    ]);
  });

  void test("bounds that cannot be formatted are left to CEL", () => {
    const rules = create(DurationRulesSchema, {
      in: [{ seconds: 1n, nanos: -1 }],
    });
    assert.equal(
      tryBuildNativeTimeRules(rules, buildPath(DurationRulesSchema), false),
      undefined,
    );
  });
});
