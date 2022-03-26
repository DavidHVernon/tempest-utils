import _ from 'lodash';
import CryptoJS from 'crypto-js';

let uuid = null
function setUuidFunction(_uuid) {
    uuid = _uuid
}

function tmAssert(expression, message) {
    if (!expression) {
        console.log(`Assertion Failed: ${message}`)
        throw message
    }
}

function groupByUnique(array, key) {
    if (!array) return null
    var index = {}
    for (const elem of array) {
        index[elem[key]] = elem
    }
    return index
}

function groupBy(array, key) {
    if (!array) return null
    var index = {}
    for (const elem of array) {
        if (!(elem[key] in index)) {
            index[elem[key]] = []
        }
        index[elem[key]].push(elem)
    }
    return index
}

function hash(obj) {
    return CryptoJS.SHA256(JSON.stringify(obj)).toString(CryptoJS.enc.Base64)
}

function createTransaction(original, result) {

    _initMetaData(result)

    // ??? Why are we copying result/ original at this phase.
    // Not really sure its necessary. 

    const newObjList = flattenTree(_.cloneDeep(result))
    const newObjIdList = _idListFromObjList(newObjList)
    const newObjById = groupByUnique(newObjList, 'id')

    const origObjList = flattenTree(_.cloneDeep(original))
    const origObjIdList = _idListFromObjList(origObjList)
    const origObjById = groupByUnique(origObjList, 'id')

    const allIdList = setUnion(newObjIdList, origObjIdList)

    let transaction = {
        id: uuid(),
        cls: 'transaction',
        timestamp: new Date(),
        mark: null
    }

    let diffList = []
    for (const id of allIdList) {
        const diff = diffObjects(origObjById[id], newObjById[id])
        if (diff) diffList.push(diff)
    }
    if (diffList.length) {
        transaction.diffList = diffList
    }
    else {
        transaction = null
    }

    return transaction
}

function _initMetaData(parent) {
    if (typeof parent == 'object') {
        if (Array.isArray(parent)) {
            parent.forEach((child) => _initMetaData(child))
        }
        else {
            // Set the new objects id
            if (parent.cls && !parent.id) {
                parent.id = uuid()
            }
            // Set foreign key relationship (1)
            for (let prop in parent) {
                if (prop.substring(prop.length - 4) == 'List') {
                    const [name, clsName] = parseForeignKey(prop)
                    _addForeignKey(`${parent.cls}Id`, parent.id, parent[prop])
                    _addClassName(clsName, parent[prop])
                }
            }
            for (let prop in parent) {
                if (parent[prop]) {
                    _initMetaData(parent[prop])
                }
            }
        }
    }

    return parent

    function _addForeignKey(key, value, objList) {
        for (let obj of objList) {
            obj[key] = value
        }
    }

    function _addClassName(clsName, objList) {
        for (let obj of objList) {
            obj['cls'] = clsName
        }
    }

    // Footnotes:
    // (1) The convention in tempest is that if any object has a property called
    //     [cls]List then that property is
    //      a) assumed to be an array
    //      b) of tempest objects
    //      c) of cls.
    //     In this case we do not require the user to set the foreign key. Instead
    //     that is done automatically here. 
}

function parseForeignKey(key) {
    // eg: deletedPageList -> deletedPage -> [ deleted, page ]
    //                               ^
    //     pageList        -> page        -> [ null, page ]
    //                            ^

    tmAssert(key.substr(key.length - 4, 4) == 'List', 'object lists must end in "List"')
    key = key.substr(0, key.length - 4)

    let desc = ''
    let cls = ''
    let i

    for (i = 0; i < key.length; i++) {
        const char = key[i]
        if (char == char.toUpperCase()) {
            break
        }
    }
    if (i < key.length) {
        return [key.substr(0, i), key.substr(i, key.length - i).toLowerCase()]
    }
    else {
        return [null, key]
    }

}

function _idListFromObjList(objList) {
    let idList = []
    for (const obj of objList) {
        idList.push(obj.id)
    }
    return idList
}

function flattenTree(parent) {

    let list = []

    if (parent != null) {
        __flattenTree(parent)
    }

    return list

    function __flattenTree(parent) {
        if (typeof parent == 'object') {
            if (Array.isArray(parent)) {
                for (const child of parent) {
                    __flattenTree(child)
                }
            }
            else {
                let propsToRemove = []
                for (const prop of Object.getOwnPropertyNames(parent)) {
                    if (prop.substring(prop.length - 4) == 'List') {
                        __flattenTree(parent[prop])
                        propsToRemove.push(prop)
                    }
                }
                for (const prop of propsToRemove) {
                    delete parent[prop]
                }
                if ('cls' in parent) {
                    list.push(parent)
                }
            }
        }
    }
}

function diffObjects(origObj, newObj) {
    tmAssert(origObj || newObj, 'Must provide at least one object')
    if (origObj && newObj) tmAssert((origObj.id == newObj.id), 'Object ids must match')

    // Get id and class_name
    let targetId = newObj ? newObj.id : origObj.id
    let targetCls = newObj ? newObj.cls : origObj.cls

    // Build output object
    let diffObject = {
        targetCls: targetCls,
        targetId: targetId,
        op: null,
        oldValue: {},
        newValue: {},
    }

    // Determine insert/update/delete
    if (origObj && !newObj) {
        diffObject.op = 'delete'
    }
    else if (!origObj && newObj) {
        diffObject.op = 'insert'
    }
    else {
        diffObject.op = 'update'
    }

    // Process keys/value pairs
    let origSet = new Set(Object.keys(origObj ? origObj : {}))
    let newSet = new Set(Object.keys(newObj ? newObj : {}))
    let anyChanges = false

    // Modified properties
    setIntersection(origSet, newSet).forEach((key) => {
        if (key != 'meta') {
            if (!_.isEqual(origObj[key], newObj[key])) {
                diffObject.oldValue[key] = origObj[key]
                diffObject.newValue[key] = newObj[key]
                anyChanges = true
            }
        }
    })
    // Added properties 
    setDifference(newSet, origSet).forEach((key) => {
        diffObject.newValue[key] = newObj[key]
        anyChanges = true
    })
    // Removed properties
    setDifference(origSet, newSet).forEach((key) => {
        if (origObj[key] != null) {
            diffObject.oldValue[key] = origObj[key]
            anyChanges = true
        }
    })

    // Remove unneeded output
    if (diffObject.op == 'delete') {
        delete diffObject.newValue
    }
    else if (diffObject.op == 'insert') {
        delete diffObject.oldValue
    }

    if (!anyChanges) diffObject = null

    return diffObject
}

function setUnion(a, b) {
    return new Set([...a, ...b])
}

function setIntersection(a, b) {
    return new Set([...a].filter(x => b.has(x)));
}

function setDifference(a, b) {
    return new Set([...a].filter(x => !b.has(x)));
}

function arrayDifference(A, B, key) {
    let result = []
    const BIndex = groupByUnique(B, key)
    A.forEach((a) => { if (!BIndex[a[key]]) result.push(a) })
    return result
}

function arrayIntersection(A, B) {
    const AS = new Set(A)
    const BS = new Set(B)
    const i = setIntersection(AS, BS)
    return A.filter((a) => (i.has(a)))
}

function bundleList(list, size) {
    let result = []
    let bundle = []

    for (const item of list) {
        bundle.push(item)
        if (bundle.length == size) {
            result.push(bundle)
            bundle = []
        }
    }

    if (bundle.length) {
        result.push(bundle)
    }

    return result
}

function decompileQuery(query) {
    if (query.filter) query.filter = query.filter.toString()
    if (query.sort) query.sort = query.sort.toString()
    if (query.subQueryList) query.subQueryList.forEach((subQuery) => {
        decompileQuery(subQuery)
    })
    return query
}

function compileQuery(query) {
    if (query.filter) query.filter = eval(query.filter)
    if (query.sort) query.sort = eval(query.sort)
    if (query.subQueryList) query.subQueryList.forEach((subQuery) => {
        compileQuery(subQuery)
    })
    return query
}

function isString(p) {
    return (typeof p == 'string' || p instanceof String)
}

function timeIndex(startTime) {
    return (new Date() - startTime) / 1000.00
}

function dirPathForFile(filePath) {
    let filePathParts = filePath.split('/')
    filePathParts.pop()
    let newParts = []
    filePathParts.forEach((part, i) => {
        if (i) {
            newParts.push('/')
        }
        newParts.push(part)
    })
    return ''.concat(...newParts)
}

class TMScanner {

    constructor(string, whitespaceRE) {
        this.string = string
        this.whitespaceRE = whitespaceRE
        this.stack = []
    }

    /*
        Scan the next token matching a regular expression.
    
        Params: 
    
        tokenRE         The regular expression to match with. Certian convention applies: 
                        - The regular expression must be anchored to the start of the string with ^
                        - The regulard expression must have a single group
    
                        In other words, they need to look like this: /^(MY_REG_EX)/
    
        Return:         The token pulled of the front of the string, or null if there is no match.
     */
    scan(tokenRE) {
        let match
        if (this.whitespaceRE) {
            match = this.string.match(this.whitespaceRE)
            if (match) {
                this.string = this.string.substr(match[1].length, this.string.length - match[1].length)
            }
        }

        match = this.string.match(tokenRE)
        if (match) {
            let token = match[1]
            this.string = this.string.substr(token.length, this.string.length - token.length)
            return token
        }
        return null
    }

    /*
        Push the current state onto a stack so that you can return to it later.
        (To support look-ahead parsing.)
     */
    push() { this.stack.push(this.string.slice()) }

    /*
        Return to the last state pushed.
        (To support look-ahead parsing.)
     */
    pop() { this.string = this.stack.pop(); }

}

function enqueue(q, obj) {
    q.push(obj)
}

function dequeue(q) {
    return q.shift()
}

function timeIndexToString(delta) {
    const vect = delta.toString().split('.')
    const sec = vect[0].padStart(9, '0')
    const secA = sec.substr(0, 3)
    const secB = sec.substr(3, 3)
    const secC = sec.substr(6, 3)
    if (!vect[1]) vect[1] = ''
    const mil = vect[1].padEnd(3, '0')
    return `${secA} ${secB} ${secC}.${mil}`
}

function newObjectFromClassList(clsList, clsName, props) {

    let template
    clsList.forEach((cls) => {
        if (cls.cls == clsName) {
            template = cls
        }
    })
    tmAssert(template, `Could not find class: ${clsName}.`)

    let obj = { id: uuid() }

    for (let prop in template) {
        if (isMetaData(prop)) {
            obj[prop] = template[prop]
        }
    }
    for (let prop in props) {
        if (isMetaData(prop)) {
            obj[prop] = props[prop]
        }
    }
    for (let prop in template) {
        if (!isMetaData(prop)) {
            obj[prop] = template[prop]
        }
    }
    for (let prop in props) {
        if (!isMetaData(prop)) {
            obj[prop] = props[prop]
        }
    }
    obj.meta = {
        isPurgable: true,
        createDate: null,
        accessDate: null,
        modifyDate: null
    }

    return obj

    function isMetaData(prop) {
        if (prop == 'id') {
            return true
        }
        else if (prop == 'cls') {
            return true
        }
        else if (prop.substring(prop.length - 2, 2) == 'Id') {
            return true
        }
        return false
    }
}

function stringifyContext(obj) {

    preprocessFunctions(obj)
    const str = JSON.stringify(obj, null, 2)
    _postprocessFunctions(obj)
    return str

    function preprocessFunctions(obj) {
        if (typeof obj == 'object') {
            if (Array.isArray(obj)) {
                obj.forEach((elem) => {
                    preprocessFunctions(elem)
                })
            }
            else {
                for (let prop in obj) {
                    if (prop == 'sort') {
                        if (obj.sort) obj.sort = obj.sort.toString()
                    }
                    else if (prop == 'filter') {
                        if (obj.filter) obj.filter = obj.filter.toString()
                    }
                    else {
                        preprocessFunctions(obj[prop])
                    }
                }
            }
        }
    }
}

function _postprocessFunctions(obj) {
    if (typeof obj == 'object') {
        if (Array.isArray(obj)) {
            obj.forEach((elem) => {
                _postprocessFunctions(elem)
            })
        }
        else {
            for (let prop in obj) {
                if (prop == 'sort') {
                    if (obj.sort) obj.sort = eval(obj.sort)
                }
                else if (prop == 'filter') {
                    if (obj.filter) obj.filter = eval(obj.filter)
                }
                else {
                    _postprocessFunctions(obj[prop])
                }
            }
        }
    }
}

function parseSchema(obj) {
    _postprocessFunctions(obj)
    return obj
}

export {
    arrayDifference,
    arrayIntersection,
    bundleList,
    compileQuery,
    createTransaction,
    decompileQuery,
    dequeue,
    diffObjects,
    enqueue,
    flattenTree,
    groupBy,
    groupByUnique,
    hash,
    isString,
    newObjectFromClassList,
    parseSchema,
    parseForeignKey,
    setDifference,
    setIntersection,
    setUnion,
    setUuidFunction,
    stringifyContext,
    timeIndexToString,
    tmAssert,
    TMScanner
}
