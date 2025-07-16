const Lexer = require('lib/Lexer')
const { getGrammar } = require('lib/grammar')
const Parser = require('lib/parser/Parser')
const Evaluator = require('lib/evaluator/Evaluator')
const states = require('lib/parser/states').states
const handlers = require('lib/parser/handlers')

describe('Manual Evaluation Example', () => {
  it('should demonstrate manual instance creation and evaluation', async () => {
    // ------------------------------------
    // 1. Build grammar, lexer, parser
    // ------------------------------------
    const grammar = getGrammar()
    const lexer = new Lexer(grammar)
    const parser = new Parser(grammar)

    // ------------------------------------
    // 2. Tokenise & build AST
    // ------------------------------------
    const expression = 'person.name.first'
    const tokens = lexer.tokenize(expression)

    parser.addTokens(tokens)
    const ast = parser.complete()

    // ------------------------------------
    // 3. Pass the context **into** Evaluator
    // ------------------------------------
    const context = {
      person: { name: { first: 'Jane' } },
      account: { hello: 42 },
      children: [
        { children: [{ name: 'A' }, { name: 'B' }] },
        { children: [{ name: 'C' }, { name: 'D' }] }
      ],
      arr: [10, 20, 30]
    }

    const evaluator = new Evaluator(grammar, context) // ← context here
    const result = await evaluator.eval(ast) // ← just the AST here

    // Verify the result
    expect(result).toBe('Jane')
  })

  it('should support custom { } syntax with helloWorld function parsed in AST', async () => {
    // ------------------------------------
    // 1. Build extended grammar, lexer, parser
    // ------------------------------------
    const { Jexl } = require('lib/Jexl')
    const jexl = new Jexl()

    // Add helloWorld function using jexl.addFunction() that expects (value, context)
    jexl.addFunction('helloWorld', (value, context) => {
      return value === 'Jane' ? context.account.hello : 50
    })

    const grammar = jexl._grammar

    // Add a new handler for helloWorld expressions
    handlers.helloWorldExpression = function (ast) {
      if (ast) {
        // Create a function call AST node that wraps the inner expression
        const functionCallNode = {
          type: 'FunctionCall',
          name: 'helloWorld',
          args: [ast],
          pool: 'functions'
        }
        this._placeAtCursor(functionCallNode)
      }
    }

    // Add new state for helloWorld expressions
    states.helloWorldExpression = {
      subHandler: handlers.helloWorldExpression,
      endStates: {
        closeCurl: 'expectBinOp'
      }
    }

    // Modify expectOperand state to handle { as helloWorld start
    const originalExpectOperand = { ...states.expectOperand }
    states.expectOperand = {
      ...originalExpectOperand,
      tokenTypes: {
        ...originalExpectOperand.tokenTypes,
        openCurl: { toState: 'helloWorldExpression' }
      }
    }

    const lexer = new Lexer(grammar)
    const parser = new Parser(grammar)

    // ------------------------------------
    // 2. Tokenise & build AST
    // ------------------------------------
    const expression = '1 + {person.name.first}'
    const tokens = lexer.tokenize(expression)

    parser.addTokens(tokens)
    const ast = parser.complete()

    // ------------------------------------
    // 3. Pass the context **into** Evaluator
    // ------------------------------------
    const context = {
      person: { name: { first: 'Jane' } },
      account: { hello: 42 },
      children: [
        { children: [{ name: 'A' }, { name: 'B' }] },
        { children: [{ name: 'C' }, { name: 'D' }] }
      ],
      arr: [10, 20, 30]
    }

    // Create an extended evaluator that passes context to functions
    class ExtendedEvaluator extends Evaluator {
      eval(ast) {
        if (ast.type === 'FunctionCall') {
          const pool = this._grammar[ast.pool]
          const func = pool[ast.name]
          if (!func) {
            throw new Error(`Function ${ast.name} is not defined.`)
          }
          return this.evalArray(ast.args || []).then((args) => {
            // Pass context as the second parameter to the function
            return func(...args, this._context)
          })
        }
        return super.eval(ast)
      }
    }

    const evaluator = new ExtendedEvaluator(grammar, context)
    const result = await evaluator.eval(ast)

    // helloWorld('Jane', context) returns context.account.hello (42), so 1 + 42 = 43
    expect(result).toBe(43)
  })

  it('should pass context to custom functions via ExtendedEvaluator', async () => {
    // ------------------------------------
    // 1. Build standard grammar, lexer, parser (no custom { } syntax)
    // ------------------------------------
    const { Jexl } = require('lib/Jexl')
    const jexl = new Jexl()

    // Add a custom function using jexl.addFunction() that expects (value, context)
    jexl.addFunction('customFunc', (value, context) => {
      return value + context.account.hello
    })

    const grammar = jexl._grammar
    const lexer = new Lexer(grammar)
    const parser = new Parser(grammar)

    // ------------------------------------
    // 2. Tokenise & build AST using standard function call syntax
    // ------------------------------------
    const expression = 'customFunc(10)'
    const tokens = lexer.tokenize(expression)

    parser.addTokens(tokens)
    const ast = parser.complete()

    // ------------------------------------
    // 3. Pass the context **into** ExtendedEvaluator
    // ------------------------------------
    const context = {
      person: { name: { first: 'Jane' } },
      account: { hello: 42 },
      children: [
        { children: [{ name: 'A' }, { name: 'B' }] },
        { children: [{ name: 'C' }, { name: 'D' }] }
      ],
      arr: [10, 20, 30]
    }

    // Create an extended evaluator that passes context to functions
    class ExtendedEvaluator extends Evaluator {
      eval(ast) {
        if (ast.type === 'FunctionCall') {
          const pool = this._grammar[ast.pool]
          const func = pool[ast.name]
          if (!func) {
            throw new Error(`Function ${ast.name} is not defined.`)
          }
          return this.evalArray(ast.args || []).then((args) => {
            // Pass context as the second parameter to the function
            return func(...args, this._context)
          })
        }
        return super.eval(ast)
      }

      evalSync(ast) {
        const PromiseSync = require('lib/PromiseSync')
        const originalPromise = this.Promise
        this.Promise = PromiseSync

        try {
          const syncResult = this.eval(ast)
          if (syncResult.error) throw syncResult.error
          return syncResult.value
        } finally {
          this.Promise = originalPromise
        }
      }
    }

    const evaluator = new ExtendedEvaluator(grammar, context)
    const result = await evaluator.eval(ast)

    // customFunc(10, context) returns 10 + context.account.hello = 10 + 42 = 52
    expect(result).toBe(52)
  })

  it('should pass context to custom functions via ExtendedEvaluator synchronously', () => {
    // ------------------------------------
    // 1. Build standard grammar, lexer, parser (no custom { } syntax)
    // ------------------------------------
    const { Jexl } = require('lib/Jexl')
    const jexl = new Jexl()

    // Add a custom function using jexl.addFunction() that expects (value, context)
    jexl.addFunction('customFunc', (value, context) => {
      return value + context.account.hello
    })

    const grammar = jexl._grammar
    const lexer = new Lexer(grammar)
    const parser = new Parser(grammar)

    // ------------------------------------
    // 2. Tokenise & build AST using standard function call syntax
    // ------------------------------------
    const expression = 'customFunc(10)'
    const tokens = lexer.tokenize(expression)

    parser.addTokens(tokens)
    const ast = parser.complete()

    // ------------------------------------
    // 3. Pass the context **into** ExtendedEvaluator
    // ------------------------------------
    const context = {
      person: { name: { first: 'Jane' } },
      account: { hello: 42 },
      children: [
        { children: [{ name: 'A' }, { name: 'B' }] },
        { children: [{ name: 'C' }, { name: 'D' }] }
      ],
      arr: [10, 20, 30]
    }

    // Create an extended evaluator that passes context to functions
    class ExtendedEvaluator extends Evaluator {
      eval(ast) {
        if (ast.type === 'FunctionCall') {
          const pool = this._grammar[ast.pool]
          const func = pool[ast.name]
          if (!func) {
            throw new Error(`Function ${ast.name} is not defined.`)
          }
          return this.evalArray(ast.args || []).then((args) => {
            // Pass context as the second parameter to the function
            return func(...args, this._context)
          })
        }
        return super.eval(ast)
      }

      evalSync(ast) {
        const PromiseSync = require('lib/PromiseSync')
        const originalPromise = this.Promise
        this.Promise = PromiseSync

        try {
          const syncResult = this.eval(ast)
          if (syncResult.error) throw syncResult.error
          return syncResult.value
        } finally {
          this.Promise = originalPromise
        }
      }
    }

    const evaluator = new ExtendedEvaluator(grammar, context)
    const result = evaluator.evalSync(ast)

    // customFunc(10, context) returns 10 + context.account.hello = 10 + 42 = 52
    expect(result).toBe(52)
  })
})
