/**
 * 宿主 Compose DSL 的最小声明（本地开发用）。
 * 原工程由宿主源码仓库提供。这里保留 useState 的泛型签名，
 * 否则 strict 下 ctx.useState<T>() 会报 TS2347（any 不接受类型实参）。
 */
export type ComposeNode = any;

export interface ComposeDslContext {
  UI: any;
  Modifier: any;
  useState<T = any>(key: string, initial?: T): [T, (v: T) => void];
  useEffect(fn: () => void | (() => void), deps?: any[]): void;
  [k: string]: any;
}

export type ComposeDslScreen = any;