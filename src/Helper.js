'use strict'

/**
 * Collection of general purpose REGEX strings and methods not being related to SOAP or SONOS.
 *
 * @module Helpers
 * 
 * @author Henning Klages
 * 
 * @since 2020-11-21
*/

module.exports = {

  ERROR_CODES: require('./Db-Soap-Errorcodes.json'),

  PLAYER_WITH_TV: ['Sonos Beam', 'Sonos Playbar', 'Sonos Playbase', 'Sonos Arc'],

  REGEX_TIME: /^(([0-1][0-9]):([0-5][0-9]):([0-5][0-9]))$/, // Only hh:mm:ss and hours from 0 to 19
  REGEX_TIME_DELTA: /^([-+]?([0-1][0-9]):([0-5][0-9]):([0-5][0-9]))$/, // Only +/- REGEX_TIME
  REGEX_IP: /^(?:(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])(\.(?!$)|$)){4}$/,
  REGEX_HTTP: /^(http|https):\/\/.+$/,
  REGEX_SERIAL: /^([0-9a-fA-F][0-9a-fA-F]-){5}[0-9a-fA-F][0-9a-fA-F]:/, // the end might be improved
  REGEX_RADIO_ID: /^([s][0-9]+)$/,
  REGEX_2DIGITS: /^\d{1,2}$/, // up to 2 digits but at least 1
  REGEX_3DIGITS: /^\d{1,3}$/, // up to 3 digits but at least 1
  REGEX_2DIGITSSIGN: /^[-+]?\d{1,2}$/,
  REGEX_3DIGITSSIGN: /^[-+]?\d{1,3}$/,  
  REGEX_ANYCHAR: /.+/,  // any character but at least 1
  REGEX_QUEUEMODES: /^(NORMAL|REPEAT_ONE|REPEAT_ALL|SHUFFLE|SHUFFLE_NOREPEAT|SHUFFLE_REPEAT_ONE)$/i,  // mixed case allowed
  REGEX_CSV: /^[\p{L}0-9]+([: -._]{0,1}[\p{L}0-9]+)*(,[\p{L}0-9]+([: -._]{0,1}[\p{L}0-9])*)*$/u,

  NRCSP_ERRORPREFIX: 'n-r-c-s-p: ',
  NODE_SONOS_ERRORPREFIX: 'upnp: ', // all errors from services _requests
  NODE_SONOS_UPNP500: 'upnp: statusCode 500 & upnpErrorCode ', // only those with 500 (subset)

  // functions to be used in other modules

  /** Starts async discovery of SONOS player and returns ipAddress - used in callback.
   * @param  {object} node current node
   * @param  {string} serialNumber player serial number
   * @param  {function} callback function with parameter err, ipAddress
   * provides ipAddress or null (not found) and calls callback handling that.
   */
  discoverSonosPlayerBySerial: (node, serialNumber, callback) => {
    const sonos = require('sonos')

    node.debug('Start find SONOS player.')
    let ipAddress = null

    // define discovery, find matching player and return ip
    const searchTime = 4000 // in milliseconds
    node.debug('Start searching for players')
    let discovery = sonos.DeviceDiscovery({ timeout: searchTime })

    discovery.on('DeviceAvailable', sonosPlayer => {
      // serial number is in deviceDescription serialNum
      // ipAddress is in sonosPlayer.host
      sonosPlayer
        .deviceDescription()
        .then(data => {
          // compary serial numbers
          if (module.exports.isTruthyAndNotEmptyString(data.serialNum)) {
            if (data.serialNum.trim().toUpperCase() === serialNumber.trim().toUpperCase()) {
              node.debug('Found SONOS player based on serialnumber in device description.')
              if (module.exports.isTruthyAndNotEmptyString(sonosPlayer.host)) {
                // success
                node.debug('Got ipaddres from device.host.')
                ipAddress = sonosPlayer.host
                callback(null, ipAddress)
                node.debug('Cleanup disovery')
                if (module.exports.isTruthyAndNotEmptyString(discovery)) {
                  discovery.destroy()
                  discovery = null
                }
              } else {
                // failure
                throw new Error('Found player but invalid ip address')
              }
            } else {
              // continue awaiting next players
            }
          } else {
            // failure but ignore and awaiting next player
          }
          return true
        })
        .catch(error => {
          callback(error, null)
          node.debug('Cleanup discovery - error')
          if (module.exports.isTruthyAndNotEmptyString(discovery)) {
            discovery.destroy()
            discovery = null
          }
        })
    })

    // listener 'timeout' only once
    discovery.once('timeout', () => {
      node.debug('Received time out without finding any matching (serial number) SONOS player')
      // error messages in calling function
      callback(null, null)
    })
  },

  /** Show any error occurring during processing of messages in the node status and create node error.
   * 
   * @param  {object} node current node
   * @param  {object} msg current msg
   * @param  {object} error  standard node.js or created with new Error ('')
   * @param  {string} [functionName] name of calling function
   * 
   * @throws nothing
   * 
   * @returns nothing
   */
  failure: (node, msg, error, functionName) => {
  // 1. Is the error a standard nodejs error? Indicator: .code exists
  // nodejs provides an error object with properties: .code, .message .name .stack
  // See https://nodejs.org/api/errors.html for more about the error object.
  // .code provides the best information.
  // See https://nodejs.org/api/errors.html#errors_common_system_errors
  // 
  // 2. Is the error thrown in node-sonos - service _request? Indicator: .message starts with NODE_SONOS_ERRORPREFIX
  // see https://github.com/bencevans/node-sonos/blob/master/lib/services/Service.js   Service.prototype._request
  // The .message then contains either NODE_SONOS_ERRORPREFIX statusCode 500 & upnpErrorCode ' and the error.response.data
  // or NODE_SONOS_ERRORPREFIX error.message and /// and error.response.data
  // 
  // 3. Is the error from this package? Indicator: .message starts with NRCSP_ERRORPREFIX
  // 
  // 4. All other error throw inside all modules (node-sonos, axio, ...)
    node.debug(`Entering error handling from ${functionName}.`)
    let msgShort = 'unknown' // default text used for status message
    let msgDetails = 'unknown' // default text for error message in addition to msgShort
    if (module.exports.isValidPropertyNotEmptyString(error, ['code'])) {
      // 1. nodejs errors - convert into readable message
      if (error.code === 'ECONNREFUSED') {
        msgShort = 'Player refused to connect'
        msgDetails = 'Validate players ip address'
      } else if (error.code === 'EHOSTUNREACH') {
        msgShort = 'Player is unreachable'
        msgDetails = 'Validate players ip address / power on'
      } else if (error.code === 'ETIMEDOUT') {
        msgShort = 'Request timed out'
        msgDetails = 'Validate players IP address / power on'
      } else {
        // Caution: getOwn is necessary for some error messages eg play mode!
        msgShort = 'nodejs error - contact developer'
        msgDetails = JSON.stringify(error, Object.getOwnPropertyNames(error))
      }
    } else {
      // Caution: getOwn is necessary for some error messages eg play mode!
      if (module.exports.isValidPropertyNotEmptyString(error, ['message'])) {
        if (error.message.startsWith(module.exports.NODE_SONOS_ERRORPREFIX)) {
          // 2. node sonos upnp errors from service _request
          if (error.message.startsWith(module.exports.NODE_SONOS_UPNP500)) {
            const upnpErrorCode = module.exports.getErrorCodeFromEnvelope(error.message.substring(module.exports.NODE_SONOS_UPNP500.length))
            msgShort = `statusCode 500 & upnpError ${upnpErrorCode}`
            // TODO Notion Helper-Service
            msgDetails = module.exports.getErrorMessageV1(upnpErrorCode, module.exports.ERROR_CODES.UPNP, '') // only UPNP errors
          } else {
            // unlikely as all UPNP errors throw 500
            msgShort = 'statusCode NOT 500'
            msgDetails = `upnp envelope: ${error.message}`
          }
        } else if (error.message.startsWith(module.exports.NRCSP_ERRORPREFIX)) {
          // 3. my thrown errors
          msgDetails = 'none'
          msgShort = error.message.replace(module.exports.NRCSP_ERRORPREFIX, '')
        } else {
          // Caution: getOwn is necessary for some error messages eg play mode!
          msgShort = error.message
          msgDetails = JSON.stringify(error, Object.getOwnPropertyNames(error))
        }
      } else {
        // 4. all the others
        msgShort = 'Unknown error/ exception -see node.error'
        msgDetails = JSON.stringify(error, Object.getOwnPropertyNames(error))
      }
    }

    node.error(`${functionName}:${msgShort} :: Details: ${msgDetails}`, msg)
    node.status({
      fill: 'red',
      shape: 'dot',
      text: `error: ${functionName} - ${msgShort}`
    })
  },

  /** Set node status and send message.
   * 
   * @param  {object} node current node
   * @param  {object} msg current msg (maybe null)
   * @param  {string} functionName name of calling function
   */
  success: (node, msg, functionName) => {
    node.send(msg)
    node.status({ fill: 'green', shape: 'dot', text: `ok:${functionName}` })
    node.debug(`OK: ${functionName}`)
  },

  /** Validates property and returns true|false if on|off (NOT case sensitive). 
   * 
   * @param  {object} msg Node-RED message
   * @param  {string} msg.propertyName item, to be validated
   * @param  {string} propertyName property name
   * @param  {string} propertyMeaning additional information, including in error message
   * @param  {string} packageName package name, included in error message
   *
   * @returns {boolean} true/false if msg.property is "on/off" ! not case sensitive
   *
   * @throws {error} if msg[propertyName] is missing, not string, not on|off (NOT case sensitive)
   */
  isOnOff: (msg, propertyName, propertyMeaning, packageName) => {
    const path = []
    path.push(propertyName)
    if (!module.exports.isValidProperty(msg, path)) {
      throw new Error(`${packageName} ${propertyMeaning} (${propertyName}) is missing/invalid`)
    }
    const value = msg[propertyName]
    if (typeof value !== 'string') {
      throw new Error(`${packageName} ${propertyMeaning} (${propertyName}) is not string`)
    }
    if (!(value.toLowerCase() === 'on' || value.toLowerCase() === 'off')) {
      throw new Error(`${packageName} ${propertyMeaning} (${propertyName}) is not on/off`)
    }
    return (value.toLowerCase() === 'on')
  },

  /** Validates and converts msg[propertyName] to number (integer). 
   * 
   * If defaultValue is NOT given then msg[propertyName] is required! Throws error if missing.
   * If defaultValue is given then msg[propertyName] is not required and default value is only used
   * in case msg[propertyName] is not "isValidProperty" (undefined, null, NaN). 
   * The defaultValue is not used in case of wrong type, not in range.
   * defaultValue should be in range min max (not checked). 
   * 
   * @param  {object} msg Node-RED message
   * @param  {(string|number)} msg.propertyName item, to be validated, converted
   * @param  {string} propertyName property name
   * @param  {number} min minimum
   * @param  {number} max maximum, max > min
   * @param  {string} propertyMeaning additional information, including in error message
   * @param  {string} packageName package name, included in error message
   * @param  {number} [defaultValue] integer, specifies the default value. 
   *
   * @returns{number} integer in range [min,max] or defaultValue
   *
   * @throws {error} if msg[propertyName] is missing and defaultValue is undefined
   * @throws {error} msg[propertyName] is not of type string, number
   * @throws {error} min,max,defaultValue not of type number, max <= min
   */
  validateConvertToInteger: (msg, propertyName, min, max, propertyMeaning, packageName, defaultValue) => {
    // validate min max
    if (typeof min !== 'number') {
      throw new Error(`${packageName} ${propertyMeaning} min is not type number`)
    } 
    if (typeof max !== 'number') {
      throw new Error(`${packageName} ${propertyMeaning} max is not type number`)
    } 
    if (min >= max) {
      throw new Error(`${packageName} ${propertyMeaning} max must be greater then min`)
    }
    
    // if defaultValue is missing an error will be throw in case property is not defined or missing
    const requiredProperty = (typeof defaultValue === 'undefined')
    const path = []
    path.push(propertyName)
    if (!module.exports.isValidProperty(msg, path)) {
      if (requiredProperty) {
        throw new Error(`${packageName} ${propertyMeaning} (${propertyName}) is missing/invalid`)
      } else {
        // use defaultValue but check if valid
        if (typeof defaultValue !== 'number') {
          throw new Error(`${packageName} ${propertyMeaning} defaultValue is not type number`)
        } 
        if (!Number.isInteger(defaultValue)) {
          throw new Error(`${packageName} ${propertyMeaning} defaultValue is not integer`)
        }
        // no check in range to allow such as -1 to indicate no value given
        return defaultValue
      }
    }
    let value = msg[propertyName]

    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new Error(`${packageName} ${propertyMeaning} (msg.${propertyName}) is not type string/number`)
    }
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new Error(`${packageName} ${propertyMeaning} (msg.${propertyName}) is not integer`)
      }
    } else {
      // it is a string - allow signed/unsigned
      if (!module.exports.REGEX_3DIGITSSIGN.test(value)) {
        throw new Error(`${packageName} ${propertyMeaning} (msg.${propertyName} >>${value}) is not 3 signed digits only`)
      }
      value = parseInt(value)
    }
    if (!(value >= min && value <= max)) {
      throw new Error(`${packageName} ${propertyMeaning} (msg.${propertyName} >>${value}) is out of range`)
    }
    return value
  },

  /** Validates msg[propertyName] against regex and returns that value or a default value.
   * 
   * If defaultValue is NOT given then msg[propertyName] is required! Throws error if missing.
   * If defaultValue is given then msg[propertyName] is not required and default value is only used
   * in case msg[propertyName] is not "isValidProperty" (undefined, null, NaN). 
   * The defaultValue is not used in case of wrong type, not in range.
   * defaultValue should be in range min max (not checked). 
   * 
   * @param  {object} msg Node-RED message
   * @param  {string} msg.propertyName item, to be validated - maximum 3 digits
   * @param  {string} propertyName property name
   * @param  {string} regex expression to evaluate string
   * @param  {string} propertyMeaning additional information, including in error message
   * @param  {string} packageName package name, included in error message
   * @param  {string} [defaultValue] specifies the default value. If missing property is required.
   *
   * @returns{string} if defaultValue is NOT given then msg[propertyName] is required. 
   *
   * @throws {error} if msg[propertyName] is missing and defaultValue is undefined
   * @throws {error} msg[propertyName] is not of type string
   * @throws {error} if msg[propertyName] has invalid regex
   */
  stringValidRegex: (msg, propertyName, regex, propertyMeaning, packageName, defaultValue) => {
    // if defaultValue is missing and error will be throw in case property is not defined or missing
    const requiredProperty = (typeof defaultValue === 'undefined')
    const path = []
    path.push(propertyName)
    if (!module.exports.isValidProperty(msg, path)) {
      if (requiredProperty) {
        throw new Error(`${packageName} ${propertyMeaning} (${propertyName}) is missing/invalid`)
      } else {
        // set default
        return defaultValue
      }
    }
    const value = msg[propertyName]
    if (typeof value !== 'string') {
      throw new Error(`${packageName} ${propertyMeaning} (${propertyName}) is not type string`)
    }
    if (!regex.test(value)) {
      throw new Error(`${packageName} ${propertyMeaning} (${propertyName} >>${value}) has wrong syntax - Regular expression- see documentation`)
    }
    return value
  },

  /** Validates whether property is safely accessible and "truthy". Empty string allowed.
   * truthy means not undefined, null, NaN, infinite - see method isTruthy.
   * 
   * @param  {object} nestedObj object
   * @param  {array<string>} path property chain- must not be empty
   * 
   * @returns {boolean} property is accessible
   * 
   * @throws nothing
   */
  isValidProperty: (nestedObj, pathArray) => {
    const property = pathArray.reduce(
      (obj, key) => (obj && obj[key] !== 'undefined' ? obj[key] : undefined),
      nestedObj
    )
    return module.exports.isTruthy(property)
  },

  /** Validates whether property is safely accessible and "truthy". Empty string NOT allowed.
   * truthy means not undefined, null, NaN, infinite - see method isTruthy.
   * 
   * @param  {object} nestedObj object
   * @param  {array<string>} path path property chain- must not be empty
   * 
   * @returns {boolean} property is accessible and not empty string
   * 
   * @throws nothing
   */
  isValidPropertyNotEmptyString: (nestedObj, pathArray) => {
    const property = pathArray.reduce(
      (obj, key) => (obj && obj[key] !== 'undefined' ? obj[key] : undefined),
      nestedObj
    )
    return module.exports.isTruthyAndNotEmptyString(property)
  },

  /** Validates whether an const/variable is "valid". Empty string allowed!
   * Empty object/array allowed. NOT allowed: undefined or null or NaN or Infinite.
   *  
   * @param  {object|array|number|string|boolean} input const, variable
   * 
   * @returns {boolean} 
   * false: let input; let input = null; let input = undefined; let input = NaN; 
   * false: let input = 1.0 divide by 0; let input = -1.0 divide 0
   * true: let input = '', let input = {}, let input = [], let input = true
   * 
   * @throws nothing
   */
  isTruthy: input => {
    return !(typeof input === 'undefined' || input === null ||
      //this avoids NaN, positive, negative Infinite
      (typeof input === 'number' && !Number.isFinite(input)))
  },

  /** Validates whether an constant/variable is "valid". Empty string NOT allowed!
   * Empty object/array allowed. NOT allowed: undefined or null or NaN or Infinite.
   * 
   * @param  {object|array|number|string|boolean} input const, variable
   * 
   * @returns {boolean} 
   * false: let input = ''
   * false: let input; let input = null; let input = undefined; let input = NaN; 
   * false: let input = 1.0 divide by 0; let input = -1.0 divide 0
   * true: let input = {}, let input = [], let input = true
   * 
   * @throws nothing
   */
  isTruthyAndNotEmptyString: input => {
    return !(typeof input === 'undefined' || input === null ||
      //this avoids NaN, positive, negative Infinite, not empty string
      (typeof input === 'number' && !Number.isFinite(input)) || input === '')
  },

  /** Gets the property value specified by path. Use isValidProperty before!
   * 
   * @param  {object} nestedObj object
   * @param  {array<string>} path path property chain- must not be empty
   * 
   * @returns {any} value of that property
   * 
   * @throws nothing
   */
  // Source: https://dev.to/flexdinesh/accessing-nested-objects-in-javascript--9m4
  // pass in your object structure as array elements
  // const name = getNestedProperty(user, ['personalInfo', 'name']);
  // to access nested array, just pass in array index as an element the path array.
  // const city = getNestedProperty(user, ['personalInfo', 'addresses', 0, 'city']);
  // this will return the city from the first address item.
  getNestedProperty: (nestedObj, pathArray) => {
    return pathArray.reduce((obj, key) => obj[key], nestedObj)
  },

  /** Converts hh:mm:ss time to milliseconds. Does not check input!
   * 
   * @param  {string} hhmmss string in format hh:mm:ss
   * 
   * @returns {number} milliseconds as integer
   * 
   * @throws nothing
   */
  hhmmss2msec: (hhmmss) => {
    const [hours, minutes, seconds] = (hhmmss).split(':')
    return ((+hours) * 3600 + (+minutes) * 60 + (+seconds)) * 1000
  },

  /**  Get error code or empty string.
   * 
   * @param  {string} data  upnp error response as envelope with <errorCode>xxx</errorCode>
   *
   * @returns{string} error code
   * 
   * @throws nothing
   */
  getErrorCodeFromEnvelope: data => {
    let errorCode = '' // default
    if (module.exports.isTruthyAndNotEmptyString(data)) {
      const positionStart = data.indexOf('<errorCode>') + '<errorCode>'.length
      const positionEnd = data.indexOf('</errorCode>')
      if (positionStart > 1 && positionEnd > positionStart) {
        errorCode = data.substring(positionStart, positionEnd)
      }
    }
    return errorCode.trim()
  },

  /**  Get error message from error code. If not found provide 'unknown error'.
   * 
   * @param  {string} errorCode
   * @param  {JSON} upnpErrorList - simple mapping .code .message
   * @param  {JSON} [serviceErrorList] - simple mapping .code .message
   *
   * @returns{string} error text (from mapping code -  text)
   * 
   * @throws nothing
   */
  getErrorMessageV1: (errorCode, upnpErrorList, serviceErrorList) => {
    const errorText = 'unknown error' // default
    if (module.exports.isTruthyAndNotEmptyString(errorCode)) {
      if (serviceErrorList !== '') {
        for (let i = 0; i < serviceErrorList.length; i++) {
          if (serviceErrorList[i].code === errorCode) {
            return serviceErrorList[i].message
          }
        }
      }
      for (let i = 0; i < upnpErrorList.length; i++) {
        if (upnpErrorList[i].code === errorCode) {
          return upnpErrorList[i].message
        }
      }
    }
    return errorText
  }
}
