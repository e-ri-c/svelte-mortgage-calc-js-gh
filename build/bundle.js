var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src\App.svelte generated by Svelte v3.43.0 */

    function create_fragment(ctx) {
    	let main;
    	let div0;
    	let t1;
    	let div1;
    	let label0;
    	let t2;
    	let input0;
    	let t3;
    	let div4;
    	let div2;
    	let label1;
    	let t4;
    	let input1;
    	let t5;
    	let div3;
    	let t6;
    	let t7;
    	let t8;
    	let div7;
    	let div5;
    	let label2;
    	let t9;
    	let input2;
    	let t10;
    	let div6;
    	let t11_value = /*interestRate*/ ctx[5].toFixed(2) + "";
    	let t11;
    	let t12;
    	let t13;
    	let div8;
    	let t14;
    	let t15_value = /*formatter*/ ctx[7].format(/*monthlyPayment*/ ctx[4]) + "";
    	let t15;
    	let t16;
    	let div9;
    	let t17;
    	let t18_value = /*formatter*/ ctx[7].format(/*totalPaid*/ ctx[3]) + "";
    	let t18;
    	let t19;
    	let div10;
    	let t20;
    	let t21_value = /*formatter*/ ctx[7].format(/*interestPaid*/ ctx[6]) + "";
    	let t21;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			main = element("main");
    			div0 = element("div");
    			div0.innerHTML = `<h1>Mortgage Calculator JS</h1>`;
    			t1 = space();
    			div1 = element("div");
    			label0 = element("label");
    			t2 = text("Loan Amount\n      ");
    			input0 = element("input");
    			t3 = space();
    			div4 = element("div");
    			div2 = element("div");
    			label1 = element("label");
    			t4 = text("Years\n        ");
    			input1 = element("input");
    			t5 = space();
    			div3 = element("div");
    			t6 = text(/*years*/ ctx[1]);
    			t7 = text(" years");
    			t8 = space();
    			div7 = element("div");
    			div5 = element("div");
    			label2 = element("label");
    			t9 = text("Interest\n        ");
    			input2 = element("input");
    			t10 = space();
    			div6 = element("div");
    			t11 = text(t11_value);
    			t12 = text(" %");
    			t13 = space();
    			div8 = element("div");
    			t14 = text("Monthly Payments : ");
    			t15 = text(t15_value);
    			t16 = space();
    			div9 = element("div");
    			t17 = text("Total Paid : ");
    			t18 = text(t18_value);
    			t19 = space();
    			div10 = element("div");
    			t20 = text("Interest Paid : ");
    			t21 = text(t21_value);
    			attr(div0, "class", "row");
    			attr(input0, "min", "1");
    			attr(input0, "placeholder", "Enter loan amount");
    			attr(input0, "type", "number");
    			attr(input0, "class", "u-full-width");
    			attr(div1, "class", "row");
    			attr(input1, "type", "range");
    			attr(input1, "min", "1");
    			attr(input1, "max", "50");
    			attr(input1, "class", "u-full-width");
    			attr(div2, "class", "columns six");
    			attr(div3, "class", "columns six outputs svelte-xd2uo3");
    			attr(div4, "class", "row");
    			attr(input2, "type", "range");
    			attr(input2, "min", "1");
    			attr(input2, "max", "2000");
    			attr(input2, "class", "u-full-width");
    			attr(div5, "class", "columns six");
    			attr(div6, "class", "columns six outputs svelte-xd2uo3");
    			attr(div7, "class", "row");
    			attr(div8, "class", "row outputs svelte-xd2uo3");
    			attr(div9, "class", "row outputs svelte-xd2uo3");
    			attr(div10, "class", "row outputs svelte-xd2uo3");
    			attr(main, "class", "container");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, div0);
    			append(main, t1);
    			append(main, div1);
    			append(div1, label0);
    			append(label0, t2);
    			append(label0, input0);
    			set_input_value(input0, /*loanAmount*/ ctx[0]);
    			append(main, t3);
    			append(main, div4);
    			append(div4, div2);
    			append(div2, label1);
    			append(label1, t4);
    			append(label1, input1);
    			set_input_value(input1, /*years*/ ctx[1]);
    			append(div4, t5);
    			append(div4, div3);
    			append(div3, t6);
    			append(div3, t7);
    			append(main, t8);
    			append(main, div7);
    			append(div7, div5);
    			append(div5, label2);
    			append(label2, t9);
    			append(label2, input2);
    			set_input_value(input2, /*interestRateInput*/ ctx[2]);
    			append(div7, t10);
    			append(div7, div6);
    			append(div6, t11);
    			append(div6, t12);
    			append(main, t13);
    			append(main, div8);
    			append(div8, t14);
    			append(div8, t15);
    			append(main, t16);
    			append(main, div9);
    			append(div9, t17);
    			append(div9, t18);
    			append(main, t19);
    			append(main, div10);
    			append(div10, t20);
    			append(div10, t21);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "input", /*input0_input_handler*/ ctx[10]),
    					listen(input1, "change", /*input1_change_input_handler*/ ctx[11]),
    					listen(input1, "input", /*input1_change_input_handler*/ ctx[11]),
    					listen(input2, "change", /*input2_change_input_handler*/ ctx[12]),
    					listen(input2, "input", /*input2_change_input_handler*/ ctx[12])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*loanAmount*/ 1 && to_number(input0.value) !== /*loanAmount*/ ctx[0]) {
    				set_input_value(input0, /*loanAmount*/ ctx[0]);
    			}

    			if (dirty & /*years*/ 2) {
    				set_input_value(input1, /*years*/ ctx[1]);
    			}

    			if (dirty & /*years*/ 2) set_data(t6, /*years*/ ctx[1]);

    			if (dirty & /*interestRateInput*/ 4) {
    				set_input_value(input2, /*interestRateInput*/ ctx[2]);
    			}

    			if (dirty & /*interestRate*/ 32 && t11_value !== (t11_value = /*interestRate*/ ctx[5].toFixed(2) + "")) set_data(t11, t11_value);
    			if (dirty & /*monthlyPayment*/ 16 && t15_value !== (t15_value = /*formatter*/ ctx[7].format(/*monthlyPayment*/ ctx[4]) + "")) set_data(t15, t15_value);
    			if (dirty & /*totalPaid*/ 8 && t18_value !== (t18_value = /*formatter*/ ctx[7].format(/*totalPaid*/ ctx[3]) + "")) set_data(t18, t18_value);
    			if (dirty & /*interestPaid*/ 64 && t21_value !== (t21_value = /*formatter*/ ctx[7].format(/*interestPaid*/ ctx[6]) + "")) set_data(t21, t21_value);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let interestRate;
    	let totalPayments;
    	let monthlyInterestRate;
    	let monthlyPayment;
    	let totalPaid;
    	let interestPaid;
    	var formatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
    	let loanAmount = 200000;
    	let years = 15;
    	let interestRateInput = 200;

    	function input0_input_handler() {
    		loanAmount = to_number(this.value);
    		$$invalidate(0, loanAmount);
    	}

    	function input1_change_input_handler() {
    		years = to_number(this.value);
    		$$invalidate(1, years);
    	}

    	function input2_change_input_handler() {
    		interestRateInput = to_number(this.value);
    		$$invalidate(2, interestRateInput);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*interestRateInput*/ 4) {
    			$$invalidate(5, interestRate = interestRateInput / 100);
    		}

    		if ($$self.$$.dirty & /*years*/ 2) {
    			$$invalidate(8, totalPayments = years * 12);
    		}

    		if ($$self.$$.dirty & /*interestRate*/ 32) {
    			$$invalidate(9, monthlyInterestRate = interestRate / 100 / 12);
    		}

    		if ($$self.$$.dirty & /*loanAmount, monthlyInterestRate, totalPayments*/ 769) {
    			$$invalidate(4, monthlyPayment = loanAmount * Math.pow(1 + monthlyInterestRate, totalPayments) * monthlyInterestRate / (Math.pow(1 + monthlyInterestRate, totalPayments) - 1));
    		}

    		if ($$self.$$.dirty & /*monthlyPayment, totalPayments*/ 272) {
    			$$invalidate(3, totalPaid = monthlyPayment * totalPayments);
    		}

    		if ($$self.$$.dirty & /*totalPaid, loanAmount*/ 9) {
    			$$invalidate(6, interestPaid = totalPaid - loanAmount);
    		}
    	};

    	return [
    		loanAmount,
    		years,
    		interestRateInput,
    		totalPaid,
    		monthlyPayment,
    		interestRate,
    		interestPaid,
    		formatter,
    		totalPayments,
    		monthlyInterestRate,
    		input0_input_handler,
    		input1_change_input_handler,
    		input2_change_input_handler
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
      target: document.body,
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
