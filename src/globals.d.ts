/**
 * 宿主运行时的环境声明（仅供 tsc 校验，不参与打包）。
 *
 * 为什么要这个文件：插件跑在 Operit 的 JS 沙箱里，ToolPkg / Tools 是注入的全局，
 * setTimeout / console / require 也由宿主提供，而 tsconfig 只开了 lib=es2020，
 * 缺声明时 tsc 会刷几十条 TS2304。这些报错不影响产物（tsc 默认仍会 emit），
 * 但会让「编译是否干净」失去信号价值——加上这份声明后，tsc 退出码可以当门禁用。
 */

declare const ToolPkg: any;
declare const Tools: any;

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(id?: any): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearInterval(id?: any): void;

declare const console: any;
declare function require(id: string): any;

/* 注意：TS 不允许用相对路径写 ambient module 声明（"cannot specify relative
   module name"），所以 ../types/* 由 paths 映射到 src/types-shim/*（见 tsconfig）。 */