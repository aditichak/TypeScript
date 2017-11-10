/// <reference path="./harness.ts" />

// NOTE: The contents of this file are all exported from the namespace 'core'. This is to
//       support the eventual conversion of harness into a modular system.

// NOTE: Some of the functions here duplicate functionality from compiler/core.ts. They have been added
//       to reduce the number of direct dependencies on compiler and services to eventually break away
//       from depending directly on the compiler to speed up compilation time.

namespace core {
    export function identity<T>(v: T): T { return v; }

    //
    // Comparers
    //

    export type Comparer<T> = (x: T, y: T) => number;
    export type EqualityComparer<T> = (x: T, y: T) => boolean;

    export function compareNumbers(a: number, b: number): number {
        if (a === b) return 0;
        if (a === undefined) return -1;
        if (b === undefined) return +1;
        return a < b ? -1 : +1;
    }

    export function compareStrings(a: string, b: string, ignoreCase: boolean): number {
        return ignoreCase
            ? compareStringsCaseInsensitive(a, b)
            : compareStringsCaseSensitive(a, b);
    }

    // NOTE: This is a duplicate of `compareNumbers` above, but is intended to be used only with
    //       strings to reduce polymorphism.
    export function compareStringsCaseSensitive(a: string, b: string): number {
        if (a === b) return 0;
        if (a === undefined) return -1;
        if (b === undefined) return +1;
        return a < b ? -1 : +1;
    }

    export function compareStringsCaseInsensitive(a: string, b: string): number {
        if (a === b) return 0;
        if (a === undefined) return -1;
        if (b === undefined) return +1;
        a = a.toUpperCase();
        b = b.toUpperCase();
        return a < b ? -1 : a > b ? +1 : 0;
    }

    export function equateStringsCaseSensitive(a: string, b: string): boolean {
        return a === b;
    }

    export function equateStringsCaseInsensitive(a: string, b: string): boolean {
        return a === b
            || a !== undefined
            && b !== undefined
            && a.toUpperCase() === b.toUpperCase();
    }

    //
    // Collections
    //

    /**
     * A collection of key/value pairs internally sorted by key.
     */
    export class KeyedCollection<K, V> {
        private _comparer: (a: K, b: K) => number;
        private _keys: K[] = [];
        private _values: V[] = [];
        private _order: number[] = [];
        private _version = 0;
        private _copyOnWrite = false;

        constructor(comparer: (a: K, b: K) => number) {
            this._comparer = comparer;
        }

        public get size() {
            return this._keys.length;
        }

        public has(key: K) {
            return binarySearch(this._keys, key, identity, this._comparer) >= 0;
        }

        public get(key: K) {
            const index = binarySearch(this._keys, key, identity, this._comparer);
            return index >= 0 ? this._values[index] : undefined;
        }

        public set(key: K, value: V) {
            const index = binarySearch(this._keys, key, identity, this._comparer);
            if (index >= 0) {
                this._values[index] = value;
            }
            else {
                this.writePreamble();
                insertAt(this._keys, ~index, key);
                insertAt(this._values, ~index, value);
                insertAt(this._order, ~index, this._version);
                this._version++;
            }
            return this;
        }

        public delete(key: K) {
            const index = binarySearch(this._keys, key, identity, this._comparer);
            if (index >= 0) {
                this.writePreamble();
                removeAt(this._keys, index);
                removeAt(this._values, index);
                removeAt(this._order, index);
                this._version++;
                return true;
            }
            return false;
        }

        public clear() {
            if (this.size > 0) {
                this.writePreamble();
                this._keys.length = 0;
                this._values.length = 0;
                this._order.length = 0;
                this._version = 0;
            }
        }

        public forEach(callback: (value: V, key: K, collection: this) => void) {
            const keys = this._keys;
            const values = this._values;
            const order = this.getInsertionOrder();
            const version = this._version;
            this._copyOnWrite = true;
            for (const index of order) {
                callback(values[index], keys[index], this);
            }
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }

        private writePreamble() {
            if (this._copyOnWrite) {
                this._keys = this._keys.slice();
                this._values = this._values.slice();
                this._order = this._order.slice();
                this._copyOnWrite = false;
            }
        }

        private getInsertionOrder() {
            return this._order
                .map((_, i) => i)
                .sort((x, y) => compareNumbers(this._order[x], this._order[y]));
        }
    }

    /**
     * A collection of metadata that supports inheritance.
     */
    export class Metadata {
        private static readonly _undefinedValue = {};
        private _parent: Metadata | undefined;
        private _map: { [key: string]: any };
        private _version = 0;
        private _size = -1;
        private _parentVersion: number | undefined;

        constructor(parent?: Metadata) {
            this._parent = parent;
            this._map = Object.create(parent ? parent._map : null); // tslint:disable-line:no-null-keyword
        }

        public get size(): number {
            if (this._size === -1 || (this._parent && this._parent._version !== this._parentVersion)) {
                let size = 0;
                for (const _ in this._map) size++;
                this._size = size;
                if (this._parent) {
                    this._parentVersion = this._parent._version;
                }
            }
            return this._size;
        }

        public has(key: string): boolean {
            return this._map[Metadata._escapeKey(key)] !== undefined;
        }

        public get(key: string): any {
            const value = this._map[Metadata._escapeKey(key)];
            return value === Metadata._undefinedValue ? undefined : value;
        }

        public set(key: string, value: any): this {
            this._map[Metadata._escapeKey(key)] = value === undefined ? Metadata._undefinedValue : value;
            this._size = -1;
            this._version++;
            return this;
        }

        public delete(key: string): boolean {
            const escapedKey = Metadata._escapeKey(key);
            if (this._map[escapedKey] !== undefined) {
                delete this._map[escapedKey];
                this._size = -1;
                this._version++;
                return true;
            }
            return false;
        }

        public clear(): void {
            this._map = Object.create(this._parent ? this._parent._map : null); // tslint:disable-line:no-null-keyword
            this._size = -1;
            this._version++;
        }

        public forEach(callback: (value: any, key: string, map: this) => void) {
            for (const key in this._map) {
                callback(this._map[key], Metadata._unescapeKey(key), this);
            }
        }

        private static _escapeKey(text: string) {
            return (text.length >= 2 && text.charAt(0) === "_" && text.charAt(1) === "_" ? "_" + text : text);
        }

        private static _unescapeKey(text: string) {
            return (text.length >= 3 && text.charAt(0) === "_" && text.charAt(1) === "_" && text.charAt(2) === "_" ? text.slice(1) : text);
        }
    }

    export function binarySearch<T, U>(array: ReadonlyArray<T>, value: T, keySelector: (v: T) => U, keyComparer: Comparer<U>, offset?: number): number {
        if (!array || array.length === 0) {
            return -1;
        }

        let low = offset || 0;
        let high = array.length - 1;
        const key = keySelector(value);
        while (low <= high) {
            const middle = low + ((high - low) >> 1);
            const midKey = keySelector(array[middle]);
            const result = keyComparer(midKey, key);
            if (result < 0) {
                low = middle + 1;
            }
            else if (result > 0) {
                high = middle - 1;
            }
            else {
                return middle;
            }
        }

        return ~low;
    }

    export function removeAt<T>(array: T[], index: number): void {
        for (let i = index; i < array.length - 1; i++) {
            array[i] = array[i + 1];
        }

        array.length--;
    }

    export function insertAt<T>(array: T[], index: number, value: T): void {
        if (index === 0) {
            array.unshift(value);
        }
        else if (index === array.length) {
            array.push(value);
        }
        else {
            for (let i = array.length; i > index; i--) {
                array[i] = array[i - 1];
            }
            array[index] = value;
        }
    }

    export function stableSort<T>(array: T[], comparer: (x: T, y: T) => number): T[] {
        return array
            .map((_, i) => i) // create array of indices
            .sort((x, y) => comparer(array[x], array[y]) || x - y) // sort indices by value then position
            .map(i => array[i]); // get sorted array
    }

    //
    // Strings
    //

    export function padLeft(text: string, size: number, ch = " "): string {
        while (text.length < size) text = ch + text;
        return text;
    }

    export function padRight(text: string, size: number, ch = " "): string {
        while (text.length < size) text += ch;
        return text;
    }

    export function getByteOrderMarkLength(text: string): number {
        if (text.length >= 2) {
            const ch0 = text.charCodeAt(0);
            const ch1 = text.charCodeAt(1);
            if ((ch0 === 0xff && ch1 === 0xfe) ||
                (ch0 === 0xfe && ch1 === 0xff)) {
                return 2;
            }
            if (text.length >= 3 && ch0 === 0xef && ch1 === 0xbb && text.charCodeAt(2) === 0xbf) {
                return 3;
            }
        }
        return 0;
    }

    export function removeByteOrderMark(text: string): string {
        const length = getByteOrderMarkLength(text);
        return length ? text.slice(length) : text;
    }

    function splitLinesWorker(text: string, lineStarts: number[] | undefined, lines: string[] | undefined, removeEmptyElements: boolean) {
        let pos = 0;
        let end = 0;
        let lineStart = 0;
        let nonWhiteSpace = false;
        while (pos < text.length) {
            const ch = text.charCodeAt(pos);
            end = pos;
            pos++;
            switch (ch) {
                // LineTerminator
                case 0x000d: // <CR> carriage return
                    if (pos < text.length && text.charCodeAt(pos) === 0x000a) {
                        pos++;
                    }
                    // falls through

                case 0x000a: // <LF> line feed
                case 0x2028: // <LS> line separator
                case 0x2029: // <PS> paragraph separator
                    if (lineStarts) {
                        lineStarts.push(lineStart);
                    }
                    if (lines && (!removeEmptyElements || nonWhiteSpace)) {
                        lines.push(text.slice(lineStart, end));
                    }
                    lineStart = pos;
                    nonWhiteSpace = false;
                    break;

                // WhiteSpace
                case 0x0009: // <TAB> tab
                case 0x000b: // <VT> vertical tab
                case 0x000c: // <FF> form feed
                case 0x0020: // <SP> space
                case 0x00a0: // <NBSP> no-break space
                case 0xfeff: // <ZWNBSP> zero width no-break space
                case 0x1680: // <USP> ogham space mark
                case 0x2000: // <USP> en quad
                case 0x2001: // <USP> em quad
                case 0x2002: // <USP> en space
                case 0x2003: // <USP> em space
                case 0x2004: // <USP> three-per-em space
                case 0x2005: // <USP> four-per-em space
                case 0x2006: // <USP> six-per-em space
                case 0x2007: // <USP> figure space
                case 0x2008: // <USP> punctuation space
                case 0x2009: // <USP> thin space
                case 0x200a: // <USP> hair space
                case 0x202f: // <USP> narrow no-break space
                case 0x205f: // <USP> medium mathematical space
                case 0x3000: // <USP> ideographic space
                case 0x0085: // next-line (not strictly per spec, but used by the compiler)
                    break;

                default:
                    nonWhiteSpace = true;
                    break;
            }
        }
        if (lineStarts) {
            lineStarts.push(lineStart);
        }
        if (lines && (!removeEmptyElements || nonWhiteSpace)) {
            lines.push(text.slice(lineStart, text.length));
        }
    }

    export type LineStarts = ReadonlyArray<number>;

    export interface LinesAndLineStarts {
        readonly lines: ReadonlyArray<string>;
        readonly lineStarts: LineStarts;
    }

    export function getLinesAndLineStarts(text: string): LinesAndLineStarts {
        const lines: string[] = [];
        const lineStarts: number[] = [];
        splitLinesWorker(text, lineStarts, lines, /*removeEmptyElements*/ false);
        return { lines, lineStarts };
    }

    export function splitLines(text: string, removeEmptyElements = false): string[] {
        const lines: string[] = [];
        splitLinesWorker(text, /*lineStarts*/ undefined, lines, removeEmptyElements);
        return lines;
    }

    export function computeLineStarts(text: string): LineStarts {
        const lineStarts: number[] = [];
        splitLinesWorker(text, lineStarts, /*lines*/ undefined, /*removeEmptyElements*/ false);
        return lineStarts;
    }
}