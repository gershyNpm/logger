// TODO - moved `scrubbed` to instance (injection) or static class prop and this becomes a util??
// (And rename it to "@gershy/util-watcher" while we're at it??)

import '@gershy/clearing';

const { getClsName, inCls, isCls } = cl;
const limn:    typeof cl.limn      = cl.limn;
const padTail: typeof cl.padTail   = cl.padTail;
const mod:     typeof cl.mod       = cl.mod;
const merge:   typeof cl.merge     = cl.merge;

type ScrubOpts = {
  isScrub: (k: string, v: any) => boolean,
  doScrub: (v: any) => Json,
  seen: Map<any, Json>
};
const scrubbed = (val: any, opts: Partial<ScrubOpts> = {}): Json => {
  const {
    isScrub = (k: string, _v: any) => k[0] === '!',
    doScrub = ((v: any) => `$scrub(${getClsName(v)})`),
    seen = new Map<any, Json>()
  } = opts ?? {}
  
  if (val === null)        return val;
  if (isCls(val, Boolean)) return val;
  if (isCls(val, Number))  return val;
  if (isCls(val, String))  return val;
  if (seen.has(val))       return seen.get(val) ?? null;
  
  if (isCls(val, Array)) {
    
    const result: any[] = [];
    seen.set(val, result);
    for (const item of val) result.push(scrubbed(item, { isScrub, doScrub, seen }));
    return result;
    
  } else if (isCls(val, Object)) {
    
    // Consider using hashes to display scrubbed values? (Makes them correlatable!)
    
    const result = {};
    seen.set(val, result);
    for (const [ k, v ] of val[cl.walk]())
      result[k] = isScrub(k, v) ? doScrub(v) : scrubbed(v, { isScrub, doScrub, seen });
    return result;
    
  } else if (inCls(val[limn], Function)) {
    
    return scrubbed(val[limn](), { isScrub, doScrub, seen });
    
  } else {
    
    // Consider processing for other types (sets, maps?)
    return val;
    
  }
  
};

export default class Logger {
  
  public static dummy = {
    getTraceId() { return ''; },
    log() {},
    kid() { return Logger.dummy; },
    scope(...args) { return args.at(-1)(Logger.dummy); }
  } as any as Logger;
  
  protected domain: string;
  protected ctx: Obj<Json>;
  protected write: (fullCtx: Obj<Json>) => void;
  protected opts: { maxStrLen: number };
  constructor(domain: string, ctx: Obj<any> = {}, opts?: typeof this.opts, write?: typeof this.write) {
    
    this.domain = domain;
    this.ctx = {
      ...ctx,
      $:                                this.domain,
      [this.domain.split('.').at(-1)!]: Math.random().toString(36).slice(2, 12)[padTail](10, '0'),
    };
    this.opts = { maxStrLen: 250, ...opts };
    Error[cl.assert](this.opts, v => v.maxStrLen >= 10);
    
    // Note this default `this.write` function produces truncated values (sloppy outputting) in the
    // cli, but works perfectly for lambdas with json-style logging configured!
    
    this.write = write ?? ((val: Obj<Json>) => console.log(val));
    
  }
  
  protected format(v: any, seen = new Map<any, Json>()): Json {
    
    // Formats any value into json (for logging)
    
    if (v == null)         return null;
    if (isCls(v, Boolean)) return v;
    if (isCls(v, Number))  return v;
    
    if (isCls(v, String)) {
      const { maxStrLen }  = this.opts;
      if (v.length <= maxStrLen) return v;
      
      // Note slice ranges are secure due to minimum `maxStrLen` value (of 10)
      const [ l0, l1 ] = [ Math.floor(maxStrLen * 0.5), Math.ceil(maxStrLen * 0.5) ];
      return `${v.slice(0, l0)}\u2026${v.slice(-(l1 - 1))}`;
    }
    
    if (seen.has(v)) return `<cyc> ${getClsName(v)}(...)`;
    seen.set(v, '<this should never show up>');
    
    if (inCls(v[limn], Function)) {
      
      // TODO: This is a nice idea - when an error bounces up a number of nested logger scopes,
      // avoid printing the (probably verbose) error info multiple times. But I don't love this
      // approach since it's coupled to what should be the side-effect-free "format" call. For now
      // it's fine since this method is strictly only called from `Logger.prototype.log`...
      if (inCls(v, Error)) {
        const sym = Symbol.for('@gershy/logger/error/dedup');
        if (v[sym]) return v[sym];
        v[sym] = { $form: cl.getClsName(v), msg: this.format(v.message, seen) };
      }
      
      const formatted: any = {};
      seen.set(v, formatted);
      Object.assign(formatted, this.format(v[limn](), seen));
      return formatted;
      
    }
    
    if (inCls(v, Function)) {
      
      return this.format(v.toString().replace(/\n/g, ' '), seen);
      
    }
    
    if (isCls(v, Array)) {
      const arr: any[] = [];
      seen.set(v, arr);
      for (const vv of v) arr.push(this.format(vv, seen));
      return arr;
    }
    
    if (isCls(v, Object)) {
      const obj: { [K: keyof any]: any } = {};
      seen.set(v, obj);
      for (const k in v) obj[k] = this.format(v[k], seen);
      return obj;
    }
    
    return `${getClsName(v)}(...)`;
    
  }
  
  public getDomain() { return this.domain; }
  
  public getTraceId(term: string) {
    
    const traceId = this.ctx[term];
    if (!traceId) throw Error('trace term invalid')[mod]({ term, ctx: this.ctx });
    return traceId as string;
    
  }
  
  public log(data: string);
  public log(data: { $$?: string } & { [K: string]: any });
  public log(data: string | ({ $$?: string } & { [K: string]: any })) {
    
    // Use-cases:
    // 1. logger.log('a basic string')
    //    - The logged payload is converted to `{ msg: 'a basic string' }`
    // 2. logger.log({ msg: 'a basic string' })
    //    - Logged as-is; equivalent to #1
    // 3. logger.log({ $$: 'note', msg: 'a basic string' })
    //    - Same as #1 and #2, but logger domain has "note" appended to it
    // 4. logger.log({ $$: 'noteOnly' })
    //    - Logged payload will be `{}`; only info is the tag - useful for infinitesimal moments in
    //      the flamegraph!
    // 5. logger.log({ $$: 'context.noteOnly' })
    //    - Valid way to extend domain with more than 1 component at once!
    
    let dmn: null | string = null;
    if (data && isCls((data as any)?.$$, String)) ({ $$: dmn, ...data } = data as any);
    
    const domain = dmn ? [ this.domain, dmn ].join('.') : this.domain;
    
    if (!isCls(data, Object)) data = { msg: data };
    this.write({}
      [merge]({ $: this.ctx })
      [merge](scrubbed(this.format(data)) as Obj<Json>)
      [merge]({ $: { $: domain } }));
    
  }
  
  public kid(domain: string): Logger {
    const d = [ this.domain, domain ].filter(Boolean).join('.');
    const logger = new Logger(d, this.ctx, this.opts, this.write);
    return logger;
  }
  
  public scope<Fn extends (logger: Logger) => any>(domain: null | string, ctx: Obj<any>, fn: Fn): ReturnType<Fn> {
    
    const ms = Date.now();
    const logger = domain ? this.kid(domain) : this;
    
    logger.log({ $$: 'launch', ...ctx });
    const accept = val => { logger.log({ $$:                  'accept', ms: Date.now() - ms      }); return val; };
    const glitch = err => { logger.log({ $$: err.log?.term ?? 'glitch', ms: Date.now() - ms, err }); throw err;  }; // Always throws an error! Note allowing the consumer to override the logged term/domain offers a lot of flexibility!
    
    let v: any; try { v = fn(logger); } catch(err) { glitch(err); }
    
    return isCls(v, Promise)
      ? (v as Promise<unknown> & ReturnType<Fn>).then(accept, glitch)
      : accept(v);
      
  }
};
