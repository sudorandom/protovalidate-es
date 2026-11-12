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

import type { DescField, DescOneof } from "@bufbuild/protobuf";
import type { Path } from "@bufbuild/protobuf/reflect";
import { ValidationError, Violation } from "./error.js";

/**
 * Cursor maintains a field path and tracks violations.
 */
export class Cursor {
  static create(failFast: boolean, maxViolations = Number.POSITIVE_INFINITY) {
    return new Cursor(failFast, [], maxViolations, undefined, undefined);
  }

  private constructor(
    private readonly failFast: boolean,
    private readonly violations: Violation[],
    // Upper bound on collected violations. Reaching it stops validation the
    // same way failFast does, so a message with very many failing entries
    // cannot accumulate unbounded violations (and their retained field paths).
    private readonly maxViolations: number,
    private readonly parent: Cursor | undefined,
    private readonly element: Path[number] | undefined,
  ) {}

  get violated(): boolean {
    return this.violations.length > 0;
  }

  violate(
    message: string,
    ruleId: string,
    rulePath: Path,
    forMapKey = false,
  ): void {
    this.violations.push(
      new Violation(message, ruleId, this.getPath(), rulePath, forMapKey),
    );
    if (this.failFast || this.violations.length >= this.maxViolations) {
      this.throwIfViolated();
    }
  }

  throwIfViolated(): void {
    if (this.violated) {
      throw new ValidationError(this.violations);
    }
  }

  getPath(): Path {
    const path: Path = [];
    for (
      let c: Cursor | undefined = this;
      c?.element !== undefined;
      c = c.parent
    ) {
      path.push(c.element);
    }
    return path.reverse();
  }

  field(field: DescField): Cursor {
    return this.child(field);
  }

  oneof(oneof: DescOneof): Cursor {
    return this.child(oneof);
  }

  list(index: number): Cursor {
    return this.child({ kind: "list_sub", index });
  }

  mapKey(key: string | number | bigint | boolean): Cursor {
    return this.child({ kind: "map_sub", key });
  }

  private child(element: Path[number]): Cursor {
    return new Cursor(
      this.failFast,
      this.violations,
      this.maxViolations,
      this,
      element,
    );
  }
}
