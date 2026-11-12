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

import { suite, test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { assertRuleIdOrder, compile, diff } from "./testing.js";

// Wrapper fields run field-level cel/cel_expression rules against the
// unwrapped value. Each must run once, alongside any standard rule.
void suite("native wrapper rules", () => {
  const custom = `cel: { id: "custom" message: "must be greater than 100" expression: "this > 100" }`;

  void test("standard and custom rules each report once", () => {
    const s = compile(
      `message M {
        google.protobuf.Int32Value v = 1 [(buf.validate.field) = { int32: {gt: 10} ${custom} }];
      }`,
    );
    // Singular wrapper fields are unboxed in protobuf-es.
    diff(s, create(s, { v: 5 }));
    assertRuleIdOrder(s, create(s, { v: 5 }), ["custom", "int32.gt"]);
    assertRuleIdOrder(s, create(s, { v: 50 }), ["custom"]);
  });

  void test("custom rule alone reports once", () => {
    const s = compile(
      `message M {
        google.protobuf.Int32Value v = 1 [(buf.validate.field) = { ${custom} }];
      }`,
    );
    assertRuleIdOrder(s, create(s, { v: 5 }), ["custom"]);
  });

  void test("cel_expression and standard rule each report once", () => {
    const expr = "this > 100 ? '' : 'must be greater than 100'";
    const s = compile(
      `message M {
        google.protobuf.Int32Value v = 1 [(buf.validate.field) = {
          int32: {gt: 10} cel_expression: "${expr}"
        }];
      }`,
    );
    assertRuleIdOrder(s, create(s, { v: 5 }), [expr, "int32.gt"]);
  });

  void test("every wrapper type", () => {
    const s = compile(
      `message M {
        google.protobuf.DoubleValue d = 1 [(buf.validate.field).double.gt = 10];
        google.protobuf.FloatValue f = 2 [(buf.validate.field).float.gt = 10];
        google.protobuf.Int64Value i64 = 3 [(buf.validate.field).int64.gt = 10];
        google.protobuf.UInt64Value u64 = 4 [(buf.validate.field).uint64.gt = 10];
        google.protobuf.Int32Value i32 = 5 [(buf.validate.field).int32.gt = 10];
        google.protobuf.UInt32Value u32 = 6 [(buf.validate.field).uint32.gt = 10];
        google.protobuf.BoolValue b = 7 [(buf.validate.field).bool.const = true];
        google.protobuf.StringValue s = 8 [(buf.validate.field).string.const = "a"];
        google.protobuf.BytesValue bs = 9 [(buf.validate.field).bytes.len = 1];
      }`,
    );
    diff(s, create(s));
    diff(
      s,
      create(s, {
        d: 11,
        f: 11,
        i64: 11n,
        u64: 11n,
        i32: 11,
        u32: 11,
        b: true,
        s: "a",
        bs: new Uint8Array(1),
      }),
    );
    diff(
      s,
      create(s, {
        d: 1,
        f: 1,
        i64: 1n,
        u64: 1n,
        i32: 1,
        u32: 1,
        b: false,
        s: "b",
        bs: new Uint8Array(2),
      }),
    );
  });

  void test("required wrapper", () => {
    const s = compile(
      `message M {
        google.protobuf.Int32Value v = 1 [(buf.validate.field) = { required: true, int32: {gt: 10} }];
      }`,
    );
    assertRuleIdOrder(s, create(s), ["required"]);
    assertRuleIdOrder(s, create(s, { v: 5 }), ["int32.gt"]);
    assertRuleIdOrder(s, create(s, { v: 50 }), []);
  });

  void test("wrapper in a oneof", () => {
    const s = compile(
      `message M {
        oneof o {
          google.protobuf.Int32Value v = 1 [(buf.validate.field).int32.gt = 10];
        }
      }`,
    );
    // Wrapper fields in a oneof are not unboxed in protobuf-es.
    diff(s, create(s, { o: { case: "v", value: { value: 5 } } }));
    diff(s, create(s, { o: { case: "v", value: { value: 50 } } }));
  });

  void test("repeated items: standard and custom rules each report once", () => {
    const s = compile(
      `message M {
        repeated google.protobuf.Int32Value vs = 1 [(buf.validate.field).repeated.items = {
          int32: {gt: 10} ${custom}
        }];
      }`,
    );
    diff(s, create(s, { vs: [{ value: 5 }] }));
    assertRuleIdOrder(s, create(s, { vs: [{ value: 5 }] }), [
      "custom",
      "int32.gt",
    ]);
  });
});
