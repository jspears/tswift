export type Dot<T> = T extends string ? `.${T}` : never;
//This is to support `.property` notation from swift.

export type EnumOrString<T> = T | Dot<keyof T>;
export type Listen<T> = (e: T) => unknown;
export type Bindable<T> = ((t?: T) => T) & {
  value: T;
  sink(listen: Listen<T>): () => void;
  clear(): void;
};
export type Num = number | ".infinity";

export interface Size {
  width: Num;
  height: Num;
}

// Tuplify code from:
//https://stackoverflow.com/questions/55127004/how-to-transform-union-type-to-tuple-type

// oh boy don't do this
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;
type LastOf<T> = UnionToIntersection<
  T extends any ? () => T : never
> extends () => infer R
  ? R
  : never;

// TS4.1+
type TuplifyUnion<
  T,
  L = LastOf<T>,
  N = [T] extends [never] ? true : false
> = true extends N ? [] : [...TuplifyUnion<Exclude<T, L>>, L];

/**
 * Sometimes you want to be able to take named parameters,
 * and or
 *
 * Should put optional parameters last.
 */
export type NamedParameters<T> = TuplifyUnion<T[keyof T]> | [T];

type Defined<T> = T extends undefined ? never : T;

export type Bound<T> = T & {
  readonly [K in keyof T as K extends string ? `$${K}` : never]-?: Defined<
    Bindable<T[K]>
  >;
};

export type Int = number;

export interface Bounds {
  height: Num;
  width: Num;
  maxWidth: Num;
  maxHeight: Num;
}

export type PickValue<T, V = T> = {
  [K in keyof T as T[K] extends V
    ? K extends "prototype"
      ? never
      : K
    : never]: T[K];
};

export type KeyOfTypeWithType<T extends Constructor> = KeyOf<T>;

export type AbstractConstructor = abstract new (...args: any) => any;
export type Constructor = new (...args: any) => any;
export type AnyConstructor = AbstractConstructor | Constructor;

export type KeyOf<T> = T extends AnyConstructor
  ? _KeyOf<T>
  : Dot<Exclude<keyof T, "prototype">> | T;

export type _KeyOf<T extends AnyConstructor> =
  | Dot<
      keyof {
        [K in keyof T as T[K] extends InstanceType<T>
          ? K extends "prototype"
            ? never
            : K
          : never]: true;
      }
    >
  | InstanceType<T>;

export interface Identifiable {
  id: string;
}

export type ID = Identifiable["id"];

export interface Hashable {}

type D = "." | "";
export type KeyValue<T, S> = S extends `${D}${infer P extends keyof T &
  string}.${infer Rest}`
  ? KeyValue<T[P], Rest>
  : S extends keyof T
  ? T[S]
  : never;

export type KeyPath<
  T extends object,
  Key extends keyof T & string = keyof T & string
> = Key extends string
  ? T[Key] extends object
    ? `.${Key}` | `.${Key}${KeyPath<T[Key]>}`
    : `.${Key}`
  : never;

export class Optional<T> {
  static none = new Optional<any>(null);
  static some<T>(v: T) {
    return new Optional<T>(v);
  }
  constructor(public value: T) {}
}
export type Float = number;
export type Character = string;
export type Double = number;
//unknown is more accurate than typescript void which should be avoided almost all the time.
export type Void = unknown | void;

export interface Subscriber<T> {}
export interface Publisher<T> {
  send(t: T): void;
  recieve(s: Subscriber<T>): Void;
  subscribe(s: Subscriber<T>): {
    cancel(): void;
  };
}
export function map<T, R>(
  value: (T | undefined) | (T | undefined)[],
  transform: (t: T) => R
): R[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? null : transform(v)))
      .filter(Boolean) as R[];
  }
  if (value != null) {
    return [transform(value)];
  }
  return [];
}

export type ReverseMap<T extends Record<keyof T, keyof any>> = {
  [P in T[keyof T]]: {
    [K in keyof T]: T[K] extends P ? K : never;
  }[keyof T];
};
//https://github.com/microsoft/TypeScript/issues/37079

type ConstructorOverloads<T> = T extends {
  new (...args: infer A1): infer R1;
  new (...args: infer A2): infer R2;
  new (...args: infer A3): infer R3;
  new (...args: infer A4): infer R4;
}
  ? readonly [
      new (...args: A1) => R1,
      new (...args: A2) => R2,
      new (...args: A3) => R3,
      new (...args: A4) => R4
    ]
  : T extends {
      new (...args: infer A1): infer R1;
      new (...args: infer A2): infer R2;
      new (...args: infer A3): infer R3;
    }
  ? readonly [
      new (...args: A1) => R1,
      new (...args: A2) => R2,
      new (...args: A3) => R3
    ]
  : T extends {
      new (...args: infer A1): infer R1;
      new (...args: infer A2): infer R2;
    }
  ? readonly [new (...args: A1) => R1, new (...args: A2) => R2]
  : T extends {
      new (...args: infer A1): infer R1;
    }
  ? readonly [new (...args: A1) => R1]
  : never;

export type OverloadedConstructorParameters<T> =
  ConstructorOverloads<T> extends infer O
    ? {
        [K in keyof O]: ConstructorParameters<
          Extract<O[K], new (...args: any) => any>
        >;
      }
    : never;

export type OverloadedInstanceType<T> = ConstructorOverloads<T> extends infer O
  ? { [K in keyof O]: InstanceType<Extract<O[K], new (...args: any) => any>> }
  : never;
