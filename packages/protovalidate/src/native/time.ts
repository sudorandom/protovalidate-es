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

import { create, type DescMessage, toJson } from "@bufbuild/protobuf";
import type {
  PathBuilder,
  ReflectMessage,
  ScalarValue,
} from "@bufbuild/protobuf/reflect";
import {
  type Duration,
  DurationSchema,
  type Timestamp,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import type { Cursor } from "../cursor.js";
import type { Eval } from "../eval.js";
import {
  type DurationRules,
  DurationRulesSchema,
  type TimestampRules,
  TimestampRulesSchema,
} from "../gen/buf/validate/validate_pb.js";
import type { NativeDispatchResult } from "./dispatcher.js";
import { buildRange, type NumericConfig, type RangeRules } from "./numeric.js";

/**
 * Build a native evaluator for google.protobuf.Timestamp and
 * google.protobuf.Duration rules with fixed bounds.
 *
 * Both types compare as (seconds, nanos) pairs, like CEL compares them. Since
 * nanos is an int32, packing a pair into the bigint
 * `seconds * 2^32 + nanos + 2^31` preserves that order and equality, so the
 * numeric evaluator applies the rules to the packed values.
 *
 * Returns `undefined` for rules relative to the current time (lt_now, gt_now,
 * within), and for bounds CEL cannot format, which CEL evaluates instead.
 */
export function tryBuildNativeTimeRules(
  rules: TimestampRules | DurationRules,
  rulePath: PathBuilder,
  forMapKey: boolean,
): NativeDispatchResult | undefined {
  const isTimestamp = rules.$typeName == TimestampRulesSchema.typeName;
  if (
    (rules.$unknown && rules.$unknown.length > 0) ||
    (isTimestamp &&
      (rules.lessThan.case == "ltNow" ||
        rules.greaterThan.case == "gtNow" ||
        rules.within !== undefined))
  ) {
    return undefined;
  }
  const config = isTimestamp ? timestampConfig : durationConfig;
  const range: RangeRules<bigint> = {
    const: rules.const === undefined ? undefined : toKey(rules.const),
    in: isTimestamp ? [] : rules.in.map(toKey),
    notIn: isTimestamp ? [] : rules.notIn.map(toKey),
    greaterThan:
      rules.greaterThan.case == "gt" || rules.greaterThan.case == "gte"
        ? {
            case: rules.greaterThan.case,
            value: toKey(rules.greaterThan.value),
          }
        : { case: undefined },
    lessThan:
      rules.lessThan.case == "lt" || rules.lessThan.case == "lte"
        ? { case: rules.lessThan.case, value: toKey(rules.lessThan.value) }
        : { case: undefined },
    finite: undefined,
  };
  try {
    // Format every bound up front: toJson() throws for values out of range.
    for (const key of [
      range.const,
      range.greaterThan.value,
      range.lessThan.value,
      ...range.in,
      ...range.notIn,
    ]) {
      if (key !== undefined) {
        config.format(key);
      }
    }
  } catch {
    return undefined;
  }
  const result = buildRange(range, config, rulePath, forMapKey);
  if (result === undefined) {
    return undefined;
  }
  return {
    eval: new EvalTimeRules(result.eval),
    handledFields: result.handledFields,
  };
}

/**
 * Adapter that applies a numeric evaluator to the packed value of a
 * Timestamp or Duration message.
 */
class EvalTimeRules implements Eval<ReflectMessage> {
  constructor(private readonly inner: Eval<ScalarValue>) {}

  eval(val: ReflectMessage, cursor: Cursor): void {
    this.inner.eval(toKey(val.message as Timestamp | Duration), cursor);
  }

  prune(): boolean {
    return false;
  }
}

const timestampConfig = timeConfig(
  "timestamp",
  TimestampRulesSchema.field,
  TimestampSchema,
);
const durationConfig = timeConfig(
  "duration",
  DurationRulesSchema.field,
  DurationSchema,
);

function timeConfig(
  typeName: string,
  descs: NumericConfig<bigint>["descs"],
  schema: DescMessage,
): NumericConfig<bigint> {
  return {
    typeName,
    descs,
    // Format like CEL's string conversion does: the JSON representation.
    format: (key) =>
      toJson(
        schema,
        create(schema, {
          seconds: key >> 32n,
          nanos: Number(key & 0xffffffffn) - 0x80000000,
        }),
      ) as string,
    nanFailsRange: false,
  };
}

function toKey(v: Timestamp | Duration): bigint {
  return (v.seconds << 32n) + BigInt(v.nanos + 0x80000000);
}
