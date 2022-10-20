import { Param } from '@tswift/util';
import { readFile as fsReadFile } from 'fs/promises';
import { Func, handleOverload } from 'overload';
import { basename, join } from "path";
import { Node as TSNode, GetAccessorDeclaration, OptionalKind, Project, PropertyDeclaration, PropertyDeclarationStructure, Scope, SetAccessorDeclaration } from "ts-morph";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { makeConstructor } from './constructor';
import { ContextImpl } from './context';
import { assertNodeType, findSib } from './nodeHelper';
import { getParser } from "./parser";
import { parseStr, toStringLit } from "./parseStr";
import { lambdaReturn, replaceEnd, replaceStart, toParamStr, toScope, unkind } from "./text";
import { toType } from './toType';
import { ComputedPropDecl, Node, TranspileConfig } from './types';

export class Transpile {
    config: TranspileConfig;
    _parser?: Parser;


    asType(ctx: ContextImpl, namedImport?: string, moduleSpecifier: string = '@tswift/util'): string {
        if (namedImport) {
            if (namedImport in this.config.builtInTypeMap) {
                return this.config.builtInTypeMap[namedImport];
            }
            const nested = ctx.classNameFor(namedImport);
            if (ctx.hasClass(nested)) {
                return nested;
            }
            if (ctx.hasClass(namedImport)) {
                return namedImport
            }
            if (ctx.inScope(namedImport)) {
                return namedImport;
            }
            if (namedImport.trim().startsWith('{')) {
                //for anonymous types.
                return namedImport;
            }
            //  namedImport = namedImport.replace(/<.*>/, '');
            if (Object.values(this.config.builtInTypeMap).includes(namedImport)) {
                return namedImport;
            }

            ctx.addImport(namedImport, this.config.importMap[moduleSpecifier] || moduleSpecifier);
        }

        return namedImport || '';
    }
    constructor({
        readFile = fsReadFile,
        overwrite = true,
        basedir = basename,
        importMap = { 'SwiftUI': '@tswift/ui' },
        builtInTypeMap = { 'Character': 'string', 'Bool': 'boolean', 'number': 'number', 'Double': 'number', 'Int': 'number', 'String': 'string' },
        srcDir = `${__dirname}/../src`,
        project = new Project({
            tsConfigFilePath: `${__dirname}/../tsconfig.json`
        })
    }: Partial<TranspileConfig> = {}) {
        this.config = { readFile, overwrite, basedir, importMap, builtInTypeMap, srcDir, project };
    }
    async parse(content: string) {
        this._parser = await getParser();
        return this._parser.parse(content);
    }
    async transpile(name: string, content?: string) {
        if (!content) {
            content = await this.config.readFile(name, 'utf8');
        }
        const fileName = join(this.config.srcDir, replaceEnd('.swift', name) + '.ts');
        const srcFile = this.config.project.createSourceFile(fileName, '', {
            overwrite: this.config.overwrite
        });

        const tree = await this.parse(content);
        this.handleRoot(tree.rootNode, new ContextImpl(srcFile).add(...Object.entries(this.config.builtInTypeMap)));

        srcFile.formatText();
        return srcFile;
    }

    handleRoot(n: Node, ctx: ContextImpl): void {
        switch (n.type) {
            case 'source_file':
                n.children.forEach(child => this.handleRoot(child, ctx));
                break;
            case 'import_declaration':
                this.asType(ctx, '', n.children[1].text);
                break;
            case 'comment':
                ctx.src.addStatements(n.text);
                break;
            case 'class_declaration':
                this.handleClassDecl(n, ctx);
                break;
            case 'function_declaration':
                this.handleFunction(n, ctx);
                break;
            case 'call_expression':
                const statements = this.handleCallExpression(n, ctx);
                ctx.src.addStatements(statements);
                break;
            case 'property_declaration':
                ctx.src.addStatements(this.processPropertyDeclaration(n, ctx));
                break;

            case 'if_statement':
                ctx.src.addStatements(this.processIfStatement(n, ctx));
                break;
            default:
                if (/statement|expression/.test(n.type)) {
                    ctx.src.addStatements(this.processNode(n, ctx));
                    break;
                }
                ctx.unknownType(n, 'handleRoot');
        }
    }

    /**
     * Maybe not what you think.  The parser calls all assignment property_declaration
     * so I am just gonna keep the name consistent.
     * @param node 
     * @param ctx 
     * @returns string[];
     */
    processPropertyDeclaration(node: Node, ctx: ContextImpl): string {
        assertNodeType(node, 'property_declaration');
        const ret: string[] = [];
        let propName = '';
        node.children.forEach(n => {
            switch (n.type) {
                case 'call_expression':
                    ret.push(this.handleCallExpression(n, ctx));
                    break;
                case 'let':
                    ret.push('const');
                    break;
                case 'var':
                    ret.push('let');
                    break;
                case 'pattern':
                    propName = this.process(ctx, n.children).join('');
                    ctx = ctx.add([propName, '']);
                    ret.push(propName);
                    break;
                case '=':
                    ret.push(n.text);
                    break;
                case 'type_annotation':
                    ret.push(':');
                    const ta = this.processTypeAnnotation(n, ctx);
                    const type = ta.type + (ta.hasQuestionToken ? '| undefined' : '');
                    ret.push(type);
                    ctx = ctx.add([propName, type]);
                    break;
                default:
                    ret.push(this.processNode(n, ctx));
            }
        });

        return ret.join(' ');
    }

    handleRHS(v: SyntaxNode, ctx: ContextImpl): string {
        // switch (v.parent?.type) {
        //     case 'directly_assignable_expression':
        //         return v.text;
        // }
        const pType = v.parent?.type;
        if (ctx.inThisScope(v.text)) {
            return `this.${v.text}`;
        }
        const nested = ctx.classNameFor(v.text)
        if (ctx.hasClass(nested)) {
            return `new ${nested}`;
        }
        if (ctx.hasClass(v.text)) {
            return `new ${v.text}`;
        }
        return v.text;
    }
    processRangeExpression(node: Node, ctx: ContextImpl) {
        assertNodeType(node, 'range_expression');
        let inclusive = false;
        const parts: string[] = [];
        node.children.forEach(n => {
            switch (n.type) {
                case '..<': break;
                case '...':
                    inclusive = true;
                    break;
                default:
                    parts.push(this.processNode(n, ctx));
                    break;
            }
        });
        return {
            from: parts[0],
            to: parts[1],
            inclusive,
        }
    }
    handleCallSuffix(node: Node, ctx: ContextImpl): string {
        assertNodeType(node, 'call_suffix');
        type Arg = {
            name?: string,
            value?: string,
        }
        const args: Arg[] = [];
        let arg: Arg = {};
        node.children.forEach(n => {
            switch (n.type) {
                case 'lambda_literal': {
                    args.push({ ...arg, value: this.processLambdaLiteral(n, ctx) });
                    arg = {};
                    break;
                }
                case ':': break;

                case 'value_arguments':
                    n.children.forEach(v => {
                        let arg: Arg | undefined;
                        switch (v.type) {
                            case 'range_expression':
                                const range = this.processRangeExpression(v.children[0], ctx);
                                this.asType(ctx, 'range');
                                throw new Error('Figure this out!');
                                const ret = 'array';
                                args.push({ value: `range({from:${range.from}, to:${range.to}, inclusive:${range.inclusive}}, ${ret})` });
                                break;
                            case '.':
                            case '[':
                            case ']':
                            case '(':
                            case ')':
                                break;
                            case ',':
                                if (arg) {
                                    args.push(arg);
                                    arg = undefined;
                                }
                                break;
                            case 'value_argument': {
                                arg = {};
                                args.push(arg);
                                v.children.forEach(va => {
                                    switch (va.type) {
                                        case 'simple_identifier':
                                            if (!arg) arg = {};
                                            arg.value = va.text;
                                            break;
                                        case ':': {
                                            if (!arg) arg = {};
                                            arg.name = arg?.value;
                                            arg.value = undefined;
                                            break;
                                        }
                                        case 'navigation_expression':
                                        default:
                                            if (!arg) arg = {};
                                            arg.value = this.processNode(va, ctx);

                                    }
                                })

                                break;
                            }


                            default:
                                ctx.unknownType(v, 'call_expression->call_suffix->value_arguments')
                        }

                    });
                    break;
                case 'simple_identifier':
                    arg.name = this.processNode(n, ctx);
                    break;
                default:
                    ctx.unknownType(n, 'call_expression->call_suffix');
            }
        });
        if (args.length == 0) {
            return '()';
        }
        if (args.some(v => v.name == null)) {
            return `(${args.map((k) => k.value).join(',')})`;
        }
        return '({' + args.map((k) => `${k.name}:${k.value}`).join(',') + '})';
    }
    handleCallExpression(node: Node, ctx: ContextImpl): string {
        let ret = '';
        node.children.forEach(n => {
            switch (n.type) {
                case 'simple_identifier':
                    this.asType(ctx, n.text);
                    ret += this.handleRHS(n, ctx);
                    break;
                case 'call_suffix':
                    ret += this.handleCallSuffix(n, ctx);
                    break;
                case 'navigation_expression':
                    ret += this.processNode(n, ctx);
                    break;
                default:
                    ctx.unknownType(n, 'call_expression');
            }
        });

        return ret;
    }

    processIfStatement(node: Node, ctx: ContextImpl): string {
        assertNodeType(node, 'if_statement');
        const ret: string[] = [];
        let isNilCheck = false;
        let hasElse = false;
        let as = '';
        node.children?.forEach(n => {
            switch (n.type) {
                case 'else':
                    hasElse = true;
                    ret.push('else');
                    break;
                case 'if':
                    isNilCheck = (n.nextSibling?.type === 'let');
                    //always insert it here, we may end up with double, otherwise we
                    // would have to paren check the whole expresion if (stuff) && (other) {
                    // is valid swift, so we can't just look at the '{' and back up.
                    ret.push(`if (${isNilCheck ? '(' : ''}`);
                    break;
                case 'let':
                    //allows let assignment in if statements.  block scoping is messed up now.
                    ret.unshift(`let ${n.nextSibling?.text};\n`);
                    break;
                case 'statements':
                    ret.push(this.processStatement(n, ctx).join(''));

                    break;
                case 'comparison_expression':
                    ret.push(this.processStatement(n, ctx).join(''));
                    break;

                case '}':
                    ret.push('\n}');
                    if (hasElse) {
                        hasElse = false;
                    }

                    break;
                case '{':
                    if (hasElse) {
                        ret.push('{\n');
                        hasElse = false;
                    } else {
                        ret.push(`${isNilCheck ? `) != null ${as}` : ''}){\n`);
                    }
                    break;
                case '=':
                    ret.push(' = ');
                    break;
                case 'simple_identifier':
                    ret.push(this.processNode(n, ctx));
                    break;
                case 'if_statement':
                    ret.push(this.processIfStatement(n, ctx))
                    break;
                case 'as_expression':
                    const label = n.children[0].text;
                    ret.push(label);
                    as = `&& ${label} instanceof ${ctx.classNameFor(n.children[2].text)}`;
                    break;
                default:
                    ctx.unknownType(n, 'if_statement');
                    ret.push(...this.processStatement(n, ctx));
            }
        });
        return ret.join(' ');
    }
    //node.type === 'switch_statement';
    processSwitchStatement(node: Node, ctx: ContextImpl): string {
        assertNodeType(node, 'switch_statement');
        const ret: string[] = [];
        node.children.forEach(n => {

            switch (n.type) {
                case 'self_expression':

                    ret.push('this');

                    break;
                case 'switch':
                    ret.push(n.text + '(');
                    break;
                case 'switch_entry':
                    n.children.forEach(se => {
                        switch (se.type) {
                            case 'default_keyword':
                                ret.push(se.text + ': ');
                                break;
                            case ':':
                                //by swallowing the colon we let the and adding case we support 
                                //fallthrough/mutltiple match of swift.
                                break;
                            case ',':
                                ret.push(' case ')
                                break;
                            case 'case':
                                ret.push(' ' + se.text + ' ');
                                break;
                            case 'switch_pattern':
                                if (se.text.startsWith('.')) {
                                    ret.push(`${ctx.getClassOrThrow('switch_pattern requires a class').getName()}${se.text}:`);
                                } else {
                                    ret.push(`${se.text}:`);
                                }
                                break;
                            case 'statements':
                                ret.push(this.processStatement(se, ctx).join(' '));
                                ret.push(';break;\n');
                                break;
                            default:
                                ctx.unknownType(se, 'switch_entry');
                        }
                    });
                    break;
                case '{':
                    ret.push(')' + n.text + '\n');
                    break;
                case '}':
                    ret.push(n.text);
                    break;
                case 'simple_identifier':
                    ret.push(this.handleRHS(n, ctx));
                    break;

                default:
                    ctx.unknownType(n, 'switch_statement');

            }
        });
        return ret.join('')
    }
    process(ctx: ContextImpl, n: Node[], start: number = 0, end: number | undefined = undefined, fn = this.processNode): string[] {
        return ((start || end) ? n.slice(start, end) : n).map(v => fn.call(this, v, ctx));
    }
    processDictionaryLiteral(n: Node, ctx: ContextImpl): string {
        assertNodeType(n, 'dictionary_literal');
        return n.children.reduce((ret, n) => {
            switch (n.type) {
                case ']': return ret + '\n}';
                case '[': return ret + '{\n';
                case ',': return ret + ',\n';
                case ':': return ret + ': ';
                default: return ret + this.processNode(n, ctx);
            }
        }, '');
    }
    processGuardStatement(n: Node, ctx: ContextImpl): string {
        assertNodeType(n, 'guard_statement');
        const { children } = n;
        let ret = '';
        if (children[1].type === 'let') {
            ret += `\nif (${children[4].text} == null){\n`;
            const state = findSib('statements', children[4]);
            ret += this.processNode(state, ctx);
            ret += '\n}\n'
            ret += `const ${children[2].text} = ${children[4].text}`;
        } else {
            const state = findSib('statements', children[2]);
            ret += `\nif(${this.processNode(children[1], ctx)}){\n`
            ret += this.processNode(state, ctx);
            ret += '\n}\n';
        }

        return ret;
    }
    /**
     * These are not cloneable.
     * @param n 
     * @param ctx 
     * @returns 
     */
    processLiteral(n: Node, ctx: ContextImpl): string | undefined {
        switch (n.type) {
            case 'float_literal':
            case 'double_literal':
            case 'real_literal':
            case 'boolean_literal':
            case 'integer_literal':
            case 'oct_literal':
            case 'hex_literal':
            case 'bin_literal':
                if (n.nextSibling?.type == 'navigation_suffix') {
                    //This fixes 25.4..mm
                    return n.text.includes('.') ? n.text : `${n.text}.`;
                }
                return n.text;
            case 'self_expression':
                //So yeah for extending Number this needs to be anything.
                // I dunno maybe a better way to make that all work but...

                switch (n.nextSibling?.type) {
                    case '/':
                    case '*':
                    case '-':
                    case '+':
                    case '+=':
                    case '/=':
                    case '*=':
                    case '-=':
                        return 'this as any';
                }
                return 'this';
            case 'nil':
                return 'undefined';
            case 'dictionary_literal':
                return this.processDictionaryLiteral(n, ctx);
            case 'array_literal':
                this.asType(ctx, 'SwiftArrayT');
                return this.process(ctx, n.children).join(' ');

            case 'line_str_text':
            case 'line_string_literal':
                const rawStr = n.children[1]?.text || n.text;
                const { literals, values } = parseStr(rawStr);
                if (values.length == 0) {
                    return JSON.stringify(rawStr);
                }
                return toStringLit({
                    literals,
                    values: values.map(v => this.processStatement(this.stringToNode(v), ctx).join(''))
                });

        }
    }
    processNode(n: Node | undefined, ctx: ContextImpl): string {
        if (n == null) {
            return '';
        }
        const litP = this.processLiteral(n, ctx);
        if (litP) {
            return litP;
        }
        switch (n.type) {
            case 'guard_statement':
                return this.processGuardStatement(n, ctx);
            case 'try_expression':
                return this.process(ctx, n.children, 1).join('') + '\n'
            case 'try':
                return '';
            case 'do':
                return 'try';
            case 'comment':

                return n.text + '\n';
            case 'pattern':
                //let (a,b) = (1,2);
                //const [a,b] = [1,2];
                if (n.nextSibling?.type === '=') {
                    const { children } = n;
                    if (children[0]?.type === '(' && children[children.length - 1]?.type === ')') {
                        return ['[', ...this.process(ctx, children, 1, -1), ']'].join(' ');
                    }
                }
                return this.processStatement(n, ctx).join('');
            case 'source_file':
                return '';
            case 'switch_statement':
                return this.processSwitchStatement(n, ctx);
            case 'simple_identifier':
                return this.handleRHS(n, ctx);
            case 'property_declaration':
                return this.processPropertyDeclaration(n, ctx);

            case 'call_expression':
                return this.handleCallExpression(n, ctx);
            case 'navigation_expression':
                //this.node.dot.node
                const [first, ...rest] = n.children;
                let start = ''
                if (first.type === 'simple_expression' && ctx.inThisScope(first.text)) {
                    start = `this.${start}`;
                } else {
                    start = this.processNode(first, ctx);
                }
                const retNe = [start, ...this.process(ctx, rest)].join('');
                return retNe;

            //                return this.processStatement(n, ctx).join('');
            case 'call_suffix':
                return this.handleCallSuffix(n, ctx);
            case 'value_arguments':
                throw new Error(`use handleCallExpression instead`);

            case 'assignment':
                const [left, op, right] = n.children;
                switch (op.type) {
                    case '=':
                    case '-=':
                    case '+=':
                    case '^=':
                    case '*=':
                        const pRight = this.processNode(right, ctx);
                        const pLeft = this.processNode(left, ctx);
                        //Probable need to do some operator overload magic in here.
                        return `${pLeft} ${op.text} ${pRight}`
                    default:
                        ctx.unknownType(op, 'processNode');
                }

            case 'tuple_expression':
                //figure out when a tuple and when an expression.  I think
                //checking for transfer control or return statement might be right.
                switch (n.parent?.type) {
                    case 'assignment':
                    case 'additive_expression':
                    case 'comparison_expression':
                    case 'multiplicative_expression':
                    case 'directly_assignable_expression':
                        return this.process(ctx, n.children).join(' ')
                }
                const tuples: [string | undefined, string | undefined][] = [];
                let name: string | undefined, value: string | undefined;
                n.children.slice(1, -1).forEach(t => {
                    switch (t.type) {
                        case 'simple_identifier':
                            value = this.processNode(t, ctx);
                            break;
                        case ':':
                            name = value;
                            value = undefined;
                            break;
                        case ',':
                            tuples.push([name, value]);
                            name = undefined;
                            value = undefined;
                            break;
                        case 'pattern':
                            name = t.text;
                            value = undefined;
                            break;
                        default:
                            value = this.processNode(t, ctx);
                        //  ctx.unknownType(t, 'tuple_expresion');
                    }
                });
                if (value || name) {
                    tuples.push([name, value])
                }
                this.asType(ctx, 'tuple');
                return `tuple(${tuples.map(([k, v]) => `[${k ? JSON.stringify(k) : 'undefined'}, ${v}]`).join(',')})`

            case 'additive_expression':
            case 'comparison_expression':
            case 'multiplicative_expression':
            case 'directly_assignable_expression':
            case 'control_transfer_statement':
                return this.processStatement(n, ctx).join(' ');
            case 'return':
            case '=':
            case '(':
            case ')':
            case ':':
            case ',':
            case '[':
            case ']':
            case '{':
            case '}':
                return n.text;
            case '*':
            case '>':
            case '<':
            case '+':
            case '/':
            case '-':
            case '+=':
            case '>=':
            case '<=':
            case '-=':
                if (n.parent?.type === 'value_argument' && n.previousSibling?.type == ':') {
                    //try to capture operator methods;
                    this.asType(ctx, 'operator');
                    return ` operator("${n.text}") `;
                }
                return ` ${n.text} `;
            case '"':
                if (n.parent?.type === 'line_string_literal') {
                    return '';
                }
            case 'navigation_suffix':
                return n.text;
            case 'lambda_literal':
                return this.processLambdaLiteral(n, ctx);
            case 'catch_keyword':
                return 'catch';
            case 'catch_block':
                if (n.children[1]?.type == '{') {
                    return [`catch(e)`, ...this.process(ctx, n.children, 1)].join('');
                }
                return '';
            case 'do_statement':
                return this.processStatement(n, ctx).join(' ');

            //fall through
            case 'statements':
                return this.processStatement(n, ctx).join(' ');
            case 'if_statement':
                return this.processIfStatement(n, ctx);
            case 'if':
                throw new Error('if should be handled in processIfStatement');
            case 'throw_keyword':
                return 'throw';
            case 'infix_expression':
                return this.processStatement(n, ctx).join(' ');

            case 'custom_operator':
                //says its >=
                return n.text;
            case 'for_statement':
                return this.handleForStatement(n, ctx);
            case 'is':
                return 'instanceof';
            case 'user_type':
                return this.asType(ctx, n.text);
            case 'function_type':
                return this.handleFunctionType(n, ctx);
            case 'ERROR':
                throw new Error(`processNode: '${n.type}' '${n.text}'`);

            default:
                ctx.unknownType(n, 'processNode');
                return n.text;
        }
    }
    /*
    handles the type of function not an actual function
    ()->Void;
    */
    handleFunctionType(node: Node, ctx: ContextImpl): string {

        assertNodeType(node, 'function_type');

        const params: Param[] = [];
        let returnType = 'unknown';

        node.children.forEach(n => {
            switch (n.type) {
                case 'user_type':
                    returnType = this.processNode(n, ctx);
                    break;
                case '->':
                    break;
                //I think this is a bug in the parser
                // so we gonna treat it like parameters.
                case 'tuple_type':
                    n.children.forEach(t => {
                        switch (t.type) {
                            case '(':
                            case ')':
                                break;
                            case 'tuple_type_item':
                                const type = this.processNode(t.children[0], ctx);
                                params.push({ name: '_', type });
                                break;
                            default:
                                ctx.unknownType(t, 'function_type->tuple_type');
                        }
                    });
                    break;
                default:
                    ctx.unknownType(n, 'function_type');
            }
        })
        if (params.length == 0) {
            return `()=>${returnType}`;
        }
        return `(${params.map(v => `${v.name || v.internal || '_'}:${v.type || 'unknown'}`)})=>${returnType}`;
    }
    handleParam(node: Node, ctx: ContextImpl): Param {
        let param: Partial<Param> = {};
        node.children.forEach(n => {
            switch (n.type) {
                case ':':
                    break;
                case 'function_type': {
                    param.type = this.processNode(n, ctx);
                    break;
                }
                case 'simple_identifier':
                    param[param.name ? 'internal' : 'name'] = n.text;
                    break;
                case 'optional_type':
                    param.optional = true;
                    param.type = this.asType(ctx, n.children[0]?.text)
                    break;

                case 'user_type':
                    param.type = this.processNode(n, ctx);
                    break;
                case 'array_type':
                    param.type = this.asType(ctx, n.children[1]?.text) + '[]';
                    break;
                default:
                    ctx.unknownType(n, 'handleParam');

            }
        });
        return param as Param;
    }
    processLambdaLiteral(node: Node, ctx: ContextImpl): string {
        assertNodeType(node, 'lambda_literal');
        const params: Param[] = [];
        let statements: string[] = [];
        let returnType = '';
        node.children.forEach(n => {
            switch (n.type) {
                case 'in':
                case '{':
                case '}':
                case '=>':
                    //swallow external {}
                    break;
                case 'lambda_function_type':
                    n.children.forEach(lft => {
                        switch (lft.type) {
                            case '(':
                            case ')':
                            case '->':
                                break;
                            case 'user_type':
                                returnType = this.processNode(lft, ctx);
                                break;
                            case 'lambda_function_type_parameters':
                                lft.children.forEach(lf => {
                                    switch (lf.type) {
                                        case ',': break;
                                        case 'lambda_parameter':
                                            params.push(this.handleParam(lf, ctx));
                                            break;
                                        default:
                                            ctx.unknownType(lf, 'lambda_literal->lambda_function_type_parameters->lambda_function_type')
                                    }
                                });
                                break;
                            default:
                                ctx.unknownType(lft, 'lambda_literal->lambda_function_type');
                        }
                    });
                    break;
                case 'statements':
                    statements = this.processStatement(n, ctx);
                    break;
                case 'comment':
                    statements.push(n.text);
                    break;
                default:
                    ctx.unknownType(n, 'lamda_literal');
            }

        });
        const finStatements = lambdaReturn(statements);
        if (!params.length) {
            for (const [name] of finStatements.matchAll(/(\$\d+?)/g)) {
                params.push({ name, type: 'unknown' });
            }
        }
        const lambda =
            (params.length == 1 && !params[0]?.type) ?
                `${toParamStr(params)}=>${finStatements}`
                :
                `(${toParamStr(params)})=>${finStatements}`;
        return lambda;
    }
    handleForStatement(node: Node, ctx: ContextImpl): string {
        assertNodeType(node, 'for_statement');
        let ret = '';
        node.children.forEach((n) => {
            switch (n.type) {
                case '(':
                    ret += 'const [ ';
                    break;
                case ')':
                    ret += ' ]'
                    break;
                case 'for':
                    ret += 'for( const ';
                    break;
                case 'in':
                    ret += ' of ';
                    break;
                case '{':
                    ret += '){\n';
                    break;
                case '}':
                    ret += '\n}\n';
                    break;
                case 'statements':
                case 'pattern':
                    ret += this.processNode(n, ctx);
                    break;
                case 'range_expression':
                    this.asType(ctx, 'range', '@tswift/util');
                    ret += `range("${n.text}")`;
                    break;
                case 'simple_identifier':
                    ret += this.processNode(n, ctx);
                    break;
                case 'call_expression':
                    ret += this.handleCallExpression(n, ctx);
                    break;
                default:
                    ctx.unknownType(n, 'for_statement')
                    ret += this.processNode(n, ctx);

            }
        });

        return ret;
    }
    stringToNode(v: string): Node {
        if (!this._parser) {
            throw new Error(`_parser not initialized`);
        }
        return this._parser?.parse(v).rootNode;
    }
    processStatement(n: Node | undefined, ctx: ContextImpl): string[] {
        return this.process(ctx, n?.children ?? []);
    }

    handleAddProperty(node: Node, ctx: ContextImpl, comment?: string): ComputedPropDecl | undefined {
        let prop: OptionalKind<PropertyDeclarationStructure> = { name: '__unknown__' };
        let computedNode: Node | undefined;

        node.children.forEach(n => {
            switch (n.type) {
                case 'let':
                    prop.isReadonly = true;
                    break;
                case 'var':
                    break;
                case 'pattern':
                    prop.name = n.text;

                    break;
                case 'modifiers': {
                    n.children.forEach(m => {
                        switch (m.type) {
                            case 'attribute':
                                const name = this.asType(ctx, replaceStart('@', m.text));
                                prop.decorators = [...(prop.decorators || []), { name }];
                                break;
                            case 'visibility_modifier':
                                prop.scope = toScope(m.text);
                                break;
                            case 'property_modifier':
                                switch (m.text) {
                                    case 'override':
                                        prop.hasOverrideKeyword = true;
                                        break;
                                    case 'abstract':
                                        prop.isAbstract = true;
                                        break;
                                    case 'static':
                                        prop.isStatic = true;
                                        break;
                                    default:
                                        ctx.unknownType(m, 'property->modifiers->property_modifier');
                                }
                                break;
                            default:
                                ctx.unknownType(m, 'property->modifiers');
                        }
                    });
                    break;
                }

                case 'line_string_literal':
                    prop.initializer = n.text;
                    prop.type = 'string';
                    break;
                case 'boolean_literal':
                    prop.initializer = n.text;
                    prop.type = 'boolean';
                    break;
                case 'real_literal':
                case 'float_literal':
                case 'double_literal':
                case 'integer_literal':
                    prop.type = 'number';
                    prop.initializer = n.text;
                    break;
                case '=':
                    break;
                case 'type_annotation':
                    Object.assign(prop, this.processTypeAnnotation(n, ctx))

                    break;
                case 'prefix_expression':
                    const type = n.parent?.children.find(v => v.type === 'type_annotation')?.children?.[1]?.text;
                    if (type) {
                        prop.initializer = `${type}${n.text}`
                    }
                    break;
                case ',':
                    const p = ctx.getClassOrThrow().addProperty(prop);
                    if (p && comment) {
                        p.addJsDoc(comment);
                        comment = undefined;
                    }
                    break;

                case 'computed_property':

                case 'call_expression':
                    computedNode = n;
                    //we'll cycle through props again, adding them
                    break;
                case 'dictionary_literal':
                    prop.initializer = this.processNode(n, ctx);
                    break;
                case 'array_literal':
                    prop.initializer = this.processStatement(n, ctx).join('');
                    break;
                default: ctx.unknownType(n, 'property');
            }
        });

        const p = ctx.getClassOrThrow().addProperty(prop);
        if (comment) {
            p.addJsDoc(comment);
        }
        if (!(p.hasQuestionToken() || p.hasInitializer())) {
        
            p.addJsDoc('@ts-ignore');   
        }
        return computedNode ? [computedNode, p] : undefined;
    }
    processTypeAnnotation(n: Parser.SyntaxNode, ctx: ContextImpl): {
        hasQuestionToken?: boolean;
        type: string
    } {
        const prop: { hasQuestionToken?: boolean, type?: string } = {}
        n.children?.forEach(t => {
            switch (t.type) {
                case 'optional_type':
                    prop.hasQuestionToken = true;
                    prop.type = this.asType(ctx, t.child(0)?.text);
                    break;
                case ':': break;
                case 'user_type':
                    prop.type = this.asType(ctx, t.text);
                    break;
                case 'opaque_type':
                    prop.type = this.asType(ctx, t.text);
                    console.log('unknown opaque_type: ' + t.text);
                    break;
                case 'array_type':
                    this.asType(ctx, 'SwiftArrayT', '@tswift/util');
                    prop.type = 'Array<' + this.asType(ctx, t.children[1]?.text) + '>';
                    break;
                default:
                    ctx.unknownType(t, 'type_annotation');
            }
        });
        if (!prop.type) {
            throw new Error(`no  type found for type_annotation: ` + n.text);
        }
        return prop as any;
    }

    handleComputedProperty(n: Node, pd: PropertyDeclaration, ctx: ContextImpl) {
        let prop: PropertyDeclaration | GetAccessorDeclaration | SetAccessorDeclaration = pd;
        const clz = ctx.getClassOrThrow();
        let getter: { statements: string[] } | undefined;
        let setter: {
            statements: string[];
            parameters: { name: string; type?: string }[];
        } | undefined;
        let decoratorType: string;

        switch (n.type) {
            case '{':
            case '}':
                break;
            case 'statements': {
                if (prop instanceof PropertyDeclaration) {
                    const struct = unkind(prop.getStructure());
                    prop.remove();
                    clz.addGetAccessor({
                        ...struct,
                        decorators: [
                            ...(struct.decorators || []),
                            { name: ctx.addImport('Cache', '@tswift/util') }],
                        statements: this.processStatement(n, ctx)
                    })
                    // prop.setInitializer(`(()=>{` +.join('\n') + '})()');
                }
                break;
            }
            case 'computed_property':
                n.children.forEach(v => {
                    switch (v.type) {
                        case '{':
                        case '}':
                            break;
                        case 'computed_setter':
                            v.children.forEach(s => {
                                switch (s.type) {
                                    case 'setter_specifier':
                                    case '{':
                                    case '(':
                                    case ')':
                                    case '}': break;
                                    case 'statements':
                                        if (!setter) setter = { statements: [], parameters: [] };
                                        setter.statements = this.processStatement(s, ctx);
                                        if (prop) {
                                            const struct = unkind(prop.getStructure());
                                            if (prop instanceof PropertyDeclaration) {
                                                prop.remove();
                                            }
                                            prop = clz?.addSetAccessor({
                                                ...struct,
                                                ...setter,
                                                returnType: undefined,
                                            });
                                        }
                                        break;
                                    case 'simple_identifier':
                                        if (!setter) setter = { statements: [], parameters: [] };
                                        setter.parameters.push({
                                            name: s.text,
                                            type: toType(prop)
                                        });
                                        break;
                                    default: ctx.unknownType(s, 'computed_property->computed_setter');

                                }
                            });
                            break;
                        case 'computed_getter':
                            v.children.forEach(s => {
                                switch (s.type) {
                                    case 'getter_specifier':
                                    case '{':
                                    case '}': break;
                                    case 'statements':
                                        if (!getter) getter = { statements: [] };
                                        getter.statements.push(...this.processStatement(s, ctx));

                                        if (prop) {
                                            const returnType = toType(prop)
                                            const struct = unkind(prop.getStructure());
                                            if (prop instanceof PropertyDeclaration) {
                                                prop.remove();
                                            }

                                            prop = clz?.addGetAccessor({
                                                ...struct,
                                                ...getter,
                                                returnType,
                                            });
                                        }
                                        break;
                                    default:
                                        console.log('unknown computed_getter', s.type);

                                }
                            })
                            break;
                        //This handles computed getters... which 
                        // is the default.
                        case 'statements':
                            if (!getter) getter = { statements: [] };
                            getter.statements.push(...this.processStatement(v, ctx));
                            if (prop) {
                                const struct = unkind(prop.getStructure());
                                if (prop instanceof PropertyDeclaration) {
                                    prop.remove();
                                }
                                prop = clz?.addGetAccessor({
                                    ...struct,
                                    ...getter
                                });
                            }
                            break;
                        default:
                            ctx.unknownType(v, 'computed_property');
                    }
                });
                break;
            case 'call_expression':
                if (n.children[1]?.children[0]?.type === 'lambda_literal') {
                    if (prop instanceof PropertyDeclaration)
                        prop.setInitializer(n.children[0].text)
                    const lamda = n.children[1].children[0].children[1];
                    lamda?.children.forEach(d => {
                        d.children?.forEach(l => {
                            switch (l.type) {
                                case 'call_suffix':
                                    const dec = prop.getDecorator(decoratorType);
                                    if (!dec) {
                                        throw new Error(`could not find decorator ` + decoratorType);
                                    }
                                    const type = toType(prop);
                                    //defaults to oldValue 
                                    const arg = l.children.reduce((ret, c) => {
                                        switch (c.type) {
                                            case 'value_arguments':
                                                return c.children.reduce((ret, va) => {
                                                    switch (va.type) {
                                                        case '(':
                                                            return `function(this:${ctx.getClassName()},`;
                                                        case 'value_argument':
                                                            return ret += va.text + (type ? `:${type}` : '');
                                                        default:
                                                            return ret + va.text;

                                                    }
                                                }, '');
                                            case 'lambda_literal':
                                                return ret += c.children?.reduce((r, k) => {
                                                    switch (k.type) {
                                                        case '}':
                                                        case '{':
                                                            return `${r}${k.text}`;
                                                        default:
                                                            return `${r} ${this.processNode(k, ctx)} `
                                                    }
                                                }, '');
                                            default:
                                                ctx.unknownType(c, 'lambda->call_expression');
                                                return ret;
                                        }
                                    }, `function(this:${ctx.getClassName()}, oldValue${type ? `:${type}` : ''})`);

                                    dec?.addArgument(arg);
                                    break;
                                //implement willSet/didSet
                                case 'simple_identifier':
                                    decoratorType = this.asType(ctx, l.text)
                                    prop?.addDecorator({ name: decoratorType });
                                    break;
                                default:
                                    ctx.unknownType(l, 'computed_property->call_expression');
                                    break;
                            }
                        });
                    })
                    break;
                } else {
                    if (prop instanceof PropertyDeclaration) {
                        prop?.setInitializer(this.processStatement(n, ctx).join(''));
                        break;
                    }
                    throw new Error(`not a property can not initialize`);
                }
                break;
            case 'simple_identifier':
                if (prop instanceof PropertyDeclaration) {
                    prop.setInitializer(this.processNode(n, ctx));
                    break;
                }
                throw new Error(`not a property can not initialize`);

            default:
                if (/_literal/.test(n.type)) {
                    if (prop instanceof PropertyDeclaration) {
                        prop.setInitializer(this.processNode(n, ctx));
                        break;
                    }
                    throw new Error(`not a property can not initialize`);

                }
                ctx.unknownType(n, 'computed_property');
        }

    }
    handleClassDecl(node: Node, ctx: ContextImpl) {
        assertNodeType(node, 'class_declaration', 'enum_declaration');
        if (node.children[0].type === 'enum') {
            return this.handleEnum(node, ctx);
        }
        return this.handleClass(node, ctx);
    }
    handleClassBody(node: Node, ctx: ContextImpl): void {
        const clz = ctx.getClassOrThrow('Class body with no class?');
        let comment: string | undefined;
        let constructors: Node[] = [];
        node.children.filter(p => p.type === 'class_declaration').forEach(v => {
            this.handleClassDecl(v, ctx);
        });
        const computedProperties: [Node, PropertyDeclaration][] = [];
        node.children.forEach(n => {
            switch (n.type) {
                case '{':
                case '}':
                    break;
                case 'property_declaration': {
                    const p = this.handleAddProperty(n, ctx, comment);
                    if (p) {
                        computedProperties.push(p);
                    }
                    comment = undefined;
                    break;
                }
                case 'comment': {
                    comment = replaceStart('//', n.text);
                    break;
                }
                case 'function_declaration':
                    if (n.child(0)?.type == 'init') {
                        constructors.push(n);
                    } else {
                        this.handleFunction(n, ctx);
                    }
                    break;
                case 'class_declaration':
                    //handled up top;
                    break;
                case 'ERROR':
                    console.warn('handleClassBody Error:', n.text);
                    break;
                default:
                    ctx.unknownType(n, 'class_body');
            }
        });
        if (comment) {
            clz.addJsDoc(comment);
        }
        //parameters before constructors or else accessors become a problem.
        this.handleComputedProperties(computedProperties, ctx);
        this.handleConstructors(constructors, ctx);
    }

    handleComputedProperties(computedProperties: ComputedPropDecl[], clz: ContextImpl) {
        computedProperties.forEach(([node, prop]) => this.handleComputedProperty(node, prop, clz));
    }

    handleConstructors(constructors: Node[], ctx: ContextImpl): void {
        const parameters: [Param[], string][] = [];

        constructors.forEach(constructor => {
            const perConst: Param[] = []
            const current: [Param[], string] = [perConst, ''];
            parameters.push(current);
            constructor.children.forEach(v => {
                switch (v.type) {
                    case 'init':
                    case '(':
                    case ',':   
                    case ')':
                        break;
                    case 'parameter': {
                        perConst.push(this.handleParam(v, ctx));
                        break;
                    }
                    case 'function_body':
                        current[1] = this.processNode(v.children[1], ctx);
                        break;
                    default: ctx.unknownType(v, 'constructor');
                }

            })
        });

        makeConstructor(parameters, ctx);
        if (ctx.isExtension) {
            const name = ctx.getClassName()?.split('$')[0] || '__PROBLEM__';
            ctx.src.addStatements(`Object.setPrototypeOf(${name}.prototype, ${ctx.getClassName()}.prototype)`)
            const project = this.config.project;
            const extensions = project.getSourceFile('src/extensions.d.ts') || this.config.project.createSourceFile('src/extensions.d.ts');
            // const mod = extensions.addModule({
            //     hasDeclareKeyword: true,
            //     name: 'global'
            // });
            extensions.addInterface({
                ...ctx.getClassOrThrow().extractInterface(),
                name
            })
            console.log(extensions.getText());
        }
    }


    handleFunction(node: Node, ctx: ContextImpl): void {
        let func: Func = {params:[]} as any;
        
        let tupleReturn: [string | undefined, string | undefined][] = [];
        node.children.forEach((n) => {
            switch (n.type) {
                case ',':
                case '(':
                case ')':
                case '->':
                case 'func': break;
                case 'parameter':
                    func.params.push(this.handleParam(n, ctx));
                    break;
                case 'modifiers':
                    if (n.text === 'mutating') {
                        ctx = ctx.mutateScope(true);
                        break;
                    }
                    func.scope = toScope(n.text);
                    break;
                case 'simple_identifier':
                    func.name = n.text;
                    break;
                case 'user_type':
                    func.returnType = this.asType(ctx, n.text);
                    break;
                case 'function_body':
                    ctx = ctx.add(...func.params);
                    n.children.forEach(f => {
                        switch (f.type) {
                            case '{':
                            case '}':
                                break;
                            default:
                                func.statements = this.processStatement(f, ctx);
                                break;
                        }
                    });
                    break;
                case 'tuple_type':
                    n.children.forEach(t => {
                        switch (t.type) {
                            case '(':
                            case ')':
                            case ',':
                                //check if its gonna be an array or an object.
                                //tuples prolly should be always an array with
                                // properties, but I dunno.
                                break;
                            case 'tuple_type_item':
                                if (t.children.length == 3) {
                                    const type = this.asType(ctx, t.children[2].text);
                                    const key = t.children[0].text;
                                    tupleReturn.push([key, type]);
                                } else {
                                    const type = this.asType(ctx, t.children[0].text);
                                    tupleReturn.push([undefined, type]);
                                }
                                break;
                            default:
                                ctx.unknownType(t, 'handleFunction->tuple_type');
                        }
                    });
                    func.returnType = `[${tupleReturn.map(([k, v]) => v).join(',')}]`;
                    break;
                case 'throws':
                    break;
                default:
                    ctx.unknownType(n, 'function');
            }
        });
        handleOverload(ctx, func);
    }
    handleEnum(node: Node, ctx: ContextImpl) {

        let enums: OptionalKind<PropertyDeclarationStructure>[] = [];
        let typeParameter: string | undefined;
        node.children.forEach(c => {
            switch (c.type) {
                case ':':
                case 'enum':
                    break;
                case 'type_identifier':
                    ctx = ctx.addClass({
                        name: c.text,
                    }, (clzName) => `return new ${clzName}(this.rawValue)`);
                    break;
                case 'inheritance_specifier':
                    typeParameter = this.asType(ctx, c.text);
                    break;
                case 'enum_class_body':
                    enums = this.processEnums(c, ctx, typeParameter);
                    break;
                default:
                    ctx.unknownType(c, 'enum');
            }
        });

        const enm = ctx.getClassOrThrow();
        enm.addProperties(enums);
        enm.addConstructor({
            parameters: [
                {
                    name: 'rawValue',
                    type: typeParameter || 'string',
                    isReadonly: true,
                    scope: Scope.Public,
                }
            ]
        });
        //add the array import.
        this.asType(ctx, 'SwiftArrayT', '@tswift/util');
        enm.addProperty({
            isStatic: true,
            name: 'allCases',
            scope: Scope.Public,
            isReadonly: true,
            initializer: `[${enums.map(v => `${enm.getName()}.${v.name}`).join(', ')}] as const`,
        });

        return enm;
    }
    processEnums(node: Node, ctx: ContextImpl, type?: string) {
        const enums: OptionalKind<PropertyDeclarationStructure>[] = [];
        let start: number | undefined;
        const clzName = ctx.getClassOrThrow().getName();
        const computedProps: ComputedPropDecl[] = []
        node.children.forEach(e => {
            switch (e.type) {
                case '{':
                case '}':
                    break;
                case 'enum_entry':
                    let enm: OptionalKind<PropertyDeclarationStructure> = {
                        name: '',
                        isStatic: true,
                        scope: Scope.Public,
                        isReadonly: true,
                    }

                    e.children.forEach(ec => {

                        switch (ec.type) {
                            case ',':
                                enums.push(enm);
                                enm = {
                                    ...enm,
                                };
                                break;
                            case '=':
                            case 'case':
                                break;
                            case 'simple_identifier':
                                enm.name = ec.text;
                                enm.initializer = start == null ?
                                    type == null ?
                                        `new ${clzName}("${enm.name}")`
                                        : `new ${clzName}()`
                                    : `new ${clzName}(${++start})`

                                break;
                            case 'integer_literal':
                                enm.initializer = `new ${clzName}(${(start = Number(ec.text))})`;
                                break;
                            default:
                                enm.initializer = `new ${clzName}(${this.processNode(ec, ctx)})`;
                        }
                    });
                    enums.push(enm);
                    break;
                case 'class_declaration':
                    this.handleClassDecl(e, ctx);
                    break;
                case 'property_declaration':
                    const p = this.handleAddProperty(e, ctx);
                    if (p) {
                        computedProps.push(p);
                    }
                    break;
                default:
                    ctx.unknownType(e, 'enum');

            }
        });
        this.handleComputedProperties(computedProps, ctx);
        return enums;
    }

    handleClass(node: Node, ctx: ContextImpl): void {
        let isStruct = false;
        let isExtension = false;
        node.children.forEach(n => {
            switch (n.type) {
                case ':':
                    break;
                case 'extension':
                    isExtension = true;
                    break;
                case 'class':
                    isStruct = false;
                    break;
                case 'struct':
                    isStruct = true;
                    break;
                case 'inheritance_specifier':
                    ctx.getClassOrThrow().setExtends(this.asType(ctx, n.text))
                    break;
                case 'user_type':
                case 'type_identifier':
                    ctx = ctx.addClass({ name: n.text }, isStruct, isExtension);
                    break;
                case 'class_body':
                    this.handleClassBody(n, ctx);
                    break;
                case 'type_parameters':
                    n.children.forEach(v => {
                        switch (v.type) {
                            case '>':
                            case '<':
                            case ',':
                                break;
                            case 'type_parameter':
                                ctx.getClassOrThrow().addTypeParameter(v.text);
                                break;
                            default:
                                ctx.unknownType(v, 'handleClass->type_parameter');
                        }
                    })
                    break;
                case 'enum':
                case 'enum_class_body':
                    break;
                case 'class_declaration':
                    this.handleClassDecl(n, ctx);
                    break;
                default:
                    ctx.unknownType(n, 'class');
            }

        });
    }
    async save() {
        return this.config.project.save();
    }
}
