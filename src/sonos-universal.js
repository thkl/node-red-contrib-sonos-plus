const {
  REGEX_SERIAL, REGEX_IP, REGEX_TIME, REGEX_TIME_DELTA, REGEX_RADIO_ID,
  NRCSP_ERRORPREFIX, PLAYER_WITH_TV, REGEX_ANYCHAR, REGEX_HTTP, REGEX_CSV, REGEX_QUEUEMODES,
  discoverSonosPlayerBySerial,
  isValidProperty, isValidPropertyNotEmptyString, isTruthyAndNotEmptyString, 
  isOnOff, string2ValidInteger, stringValidRegex,
  failure, success
} = require('./Helper.js')

const {
  getGroupMemberDataV2, playGroupNotification, playJoinerNotification,
  createGroupSnapshot, restoreGroupSnapshot, getAllPlayerList, sortedGroupArray,
  getQueueV2, getRadioId, getMusicServiceId, getMusicServiceName, executeActionV6, getSonosPlaylistsV2
} = require('./Sonos-Commands.js')

const { Sonos } = require('sonos')

/**
 * All functions provided by Universal node. Universal modes server all but commands related to groups and player.
 *
 * @module Universal
 * 
 * @author Henning Klages
 * 
 * @since 2020-11-08
*/

module.exports = function (RED) {
  'use strict'

  // function lexical order, ascending
  const COMMAND_TABLE_UNIVERSAL = {
    'coordinator.delegate': coordinatorDelegateCoordination,
    'group.adjust.volume': groupAdjustVolume,
    'group.cancel.sleeptimer': groupCancelSleeptimer,
    'group.clear.queue': groupClearQueue,
    'group.create.snap': groupCreateSnapshot,
    'group.create.volumesnap': groupCreateVolumeSnapshot,
    'group.get.actions': groupGetTransportActions,
    'group.get.crossfade': groupGetCrossfadeMode,
    'group.get.members': groupGetMembers,
    'group.get.mutestate': groupGetMute,
    'group.get.playbackstate': groupGetPlaybackstate,
    'group.get.queue': groupGetQueue,
    'group.get.sleeptimer': groupGetSleeptimer,
    'group.get.state': groupGetState,
    'group.get.trackplus': groupGetTrackPlus,
    'group.get.volume': groupGetVolume,
    'group.next.track': groupNextTrack,
    'group.pause': groupPause,
    'group.play': groupPlay,
    'group.play.export': groupPlayExport,
    'group.play.notification': groupPlayNotification,
    'group.play.queue': groupPlayQueue,
    'group.play.snap': groupPlaySnapshot,
    'group.play.streamhttp': groupPlayStreamHttpV2,
    'group.play.track': groupPlayTrack,
    'group.play.tunein': groupPlayTuneIn,
    'group.previous.track': groupPreviousTrack,
    'group.queue.uri': groupQueueUri,
    'group.queue.urispotify': groupQueueUriFromSpotify,
    'group.remove.tracks': groupRemoveTracks,
    'group.save.queue': groupSaveQueueToSonosPlaylist,
    'group.seek': groupSeek,
    'group.seek.delta': groupSeekDelta,
    'group.set.crossfade': groupSetCrossfade,
    'group.set.mutestate': groupSetMute,
    'group.set.queuemode': groupSetQueuemode,
    'group.set.sleeptimer': groupSetSleeptimer,
    'group.set.volume': groupSetVolume,
    'group.stop': groupStop,
    'group.toggle.playback': groupTogglePlayback,
    'household.create.group': householdCreateGroup,
    'household.create.stereopair': householdCreateStereoPair,
    'household.get.groups': householdGetGroups,
    'household.get.sonosplaylists': householdGetSonosPlaylists,
    'household.remove.sonosplaylist': householdRemoveSonosPlaylist,
    'household.separate.group': householdSeparateGroup,
    'household.separate.stereopair': householdSeparateStereoPair,
    'household.test.player': householdTestPlayerOnline,
    'joiner.play.notification': joinerPlayNotification,
    'player.adjust.volume': playerAdjustVolume,
    'player.become.standalone': playerBecomeStandalone,
    'player.get.bass': playerGetBass,
    'player.get.dialoglevel': playerGetEq,
    'player.get.led': playerGetLed,
    'player.get.loudness': playerGetLoudness,
    'player.get.mutestate': playerGetMute,
    'player.get.nightmode': playerGetEq,
    'player.get.properties': playerGetProperties,
    'player.get.queue': playerGetQueue,
    'player.get.role': playerGetRole,
    'player.get.subgain': playerGetEq,
    'player.get.treble': playerGetTreble,
    'player.get.volume': playerGetVolume,
    'player.join.group': playerJoinGroup,
    'player.leave.group': playerLeaveGroup,
    'player.play.avtransport': playerPlayAvtransport,
    'player.play.tv': playerPlayTv,
    'player.set.bass': playerSetBass,
    'player.set.dialoglevel': playerSetEQ,
    'player.set.led': playerSetLed,
    'player.set.loudness': playerSetLoudness,
    'player.set.mutestate': playerSetMute,
    'player.set.nightmode': playerSetEQ,
    'player.set.subgain': playerSetEQ,
    'player.set.treble': playerSetTreble,
    'player.set.volume': playerSetVolume,
    'player.execute.action': playerExecuteActionV6
  }

  /** Create Universal node, get valid ip address, store nodeDialog and subscribe to messages.
   * @param  {object} config current node configuration data
   */
  function SonosUniversalNode (config) {
    RED.nodes.createNode(this, config)
    const nrcspFunction = 'create and subscribe'
    const node = this

    // ip address overruling serialnum - at least one must be valid
    const configNode = RED.nodes.getNode(config.confignode)
    if (isValidProperty(configNode, ['ipaddress']) && typeof configNode.ipaddress === 'string' && REGEX_IP.test(configNode.ipaddress)) {
      // ip address is being used - default case
    } else {
      if (isValidProperty(configNode, ['serialnum']) && typeof configNode.serialnum === 'string' && REGEX_SERIAL.test(configNode.serialnum)) {
        discoverSonosPlayerBySerial(node, configNode.serialnum, (err, newIpAddress) => {
          if (err) {
            failure(node, null, new Error(`${NRCSP_ERRORPREFIX} could not figure out ip address (discovery)`), nrcspFunction)
            return
          }
          if (newIpAddress === null) {
            failure(node, null, new Error(`${NRCSP_ERRORPREFIX} could not find any player by serial`), nrcspFunction)
          } else {
            // setting of node status is done in following call handelInputMessage
            node.debug(`OK sonos player ${newIpAddress} was found`)
            configNode.ipaddress = newIpAddress
          }
        })
      } else {
        failure(node, null, new Error(`${NRCSP_ERRORPREFIX} both ipaddress and serial number are invalid/missing`), nrcspFunction)
        return
      }
    }

    // clear node status
    node.status({})

    // subscribe and handle input message
    node.on('input', function (msg) {
      node.debug('node - msg received')
      processInputMsg(node, config, msg, configNode.ipaddress)
        .then((msgUpdate) => {
          Object.assign(msg, msgUpdate) // defines the output message
          success(node, msg, msg.nrcspCmd)
        })
        .catch((error) => {
          let functionName = 'processing input msg'
          if (msg.nrcspCmd && typeof msg.nrcspCmd === 'string') {
            functionName = msg.nrcspCmd
          }
          failure(node, msg, error, functionName)
        })
    })
  }

  /** Validate sonos player object, command and dispatch further.
   * @param  {object}  node current node
   * @param  {object}  config current node configuration
   * @param  {string}  config.command the command from node dialog
   * @param  {string}  config.state the state from node dialog
   * @param  {boolean} config.compatibilityMode tic from node dialog
   * @param  {object}  msg incoming message
   * @param  {string}  ipaddress IP address of sonos player
   *
   * Creates also msg.nrcspCmd because in compatibility mode all get commands overwrite msg.payload (the command)
   *
   * @return {promise} All commands have to return a promise - object
   * example: returning {} means msg is not modified
   * example: returning msg[stateName]= true means the original msg.[stateName] will be modified and set to true
   */
  async function processInputMsg (node, config, msg, ipaddress) {
    const sonosPlayer = new Sonos(ipaddress)
    // set baseUrl
    if (!isTruthyAndNotEmptyString(sonosPlayer)) {
      throw new Error(`${NRCSP_ERRORPREFIX} sonos player is undefined`)
    }
    if (!(isValidPropertyNotEmptyString(sonosPlayer, ['host']) &&
      isValidPropertyNotEmptyString(sonosPlayer, ['port']))) {
      throw new Error(`${NRCSP_ERRORPREFIX} ip address or port is missing`)
    }
    sonosPlayer.baseUrl = `http://${sonosPlayer.host}:${sonosPlayer.port}` // useful for my extensions

    // handle compatibility to older nrcsp version - depreciated 2020-05-25
    // Path have to be arrays showing the path to property. 
    let cmdName = 'topic'
    let stateName = 'payload'
    if (config.compatibilityMode) {
      cmdName = 'payload'
      stateName = 'topic'
    }

    // command, required: node dialog overrules msg, store lowercase version in command
    let command
    if (config.command !== 'message') { // command specified in node dialog
      command = config.command
    } else {
      let cPath = []
      cPath.push(cmdName)
      if (!isValidPropertyNotEmptyString(msg, cPath)) {
        throw new Error(`${NRCSP_ERRORPREFIX} command is undefined/invalid`)
      }
      command = String(msg[cmdName])
      command = command.toLowerCase()

      // you may omit group. prefix - so we add it here
      const REGEX_PREFIX = /^(household|group|player|joiner)/
      if (!REGEX_PREFIX.test(command)) {
        command = `group.${command}`
      }
    }
    msg.nrcspCmd = command // store command as get commands will overrides msg.payload
    msg[cmdName] = command // sets topic - is only used in playerSetEQ, playerGetEQ

    // state: node dialog overrules msg.
    let state
    if (config.state) { // payload specified in node dialog
      state = RED.util.evaluateNodeProperty(config.state, config.stateType, node)
      if (typeof state === 'string') {
        if (state !== '') {
          msg[stateName] = state
        }
      } else if (typeof state === 'number') {
        if (state !== '') {
          msg[stateName] = state
        }
      } else if (typeof state === 'boolean') {
        msg[stateName] = state
      }
    }

    if (!Object.prototype.hasOwnProperty.call(COMMAND_TABLE_UNIVERSAL, command)) {
      throw new Error(`${NRCSP_ERRORPREFIX} command is invalid >>${command} `)
    }
    return COMMAND_TABLE_UNIVERSAL[command](node, msg, stateName, cmdName, sonosPlayer)
  }

  // ========================================================================
  //
  //             COMMANDS
  //
  // ========================================================================

  /**  Coordinator delegate coordination of group. New player must be in same group!
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg[stateName]  name of new coordinator - must be in same group as player and different!
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer - must be coordinator
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function coordinatorDelegateCoordination (node, msg, stateName, cmdName, sonosPlayer) {
    // payload new player name is required.
    const validatedPlayerName= stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'player name', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    // player must be coordinator to be able to delegate
    if (groupData.playerIndex != 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} Player must be coordinator`)
    }

    // check PlayerName is in group and not same as old coordinator 
    const indexNewCoordinator = groupData.members.findIndex(p => p.sonosName === validatedPlayerName)
    if (indexNewCoordinator === -1) {
      throw new Error(`${NRCSP_ERRORPREFIX} Could not find player name in current group`)
    }
    if (indexNewCoordinator === 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} New coordinator must be different from current coordinator`)
    }

    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'DelegateGroupCoordinationTo',
      { InstanceID: 0, 'NewCoordinator': groupData.members[indexNewCoordinator].uuid, RejoinGroup: true })

    return {}
  }
  
  /**  Adjust group volume and outputs new volume.
   * 
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {(string|number)}  msg.payload* -100 to + 100, integer (*: in compatibility mode: topic)
   * @param  {string}  [msg.playerName=using sonosPlayer] SONOS-Playername. Overrules sonosPlayer
   * @param  {string}  stateName=payload  in compatibility mode: topic
   * @param  {string}  cmdName=topic in compatibility mode: payload, not used
   * @param  {object}  sonosPlayer Sonos player from config node
   *
   * @return {Promise<String>} Returns the new group volume after adjustment as property newVolume.
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupAdjustVolume (node, msg, stateName, cmdName, sonosPlayer) {
    // payload adjusted volume is required
    const adjustVolume = string2ValidInteger(msg, stateName, -100, +100, 'adjust volume', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - returns the new value, 0 stands for coordinator
    const newVolume = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'SetRelativeGroupVolume',
      { InstanceID: 0, Adjustment: adjustVolume })
    
    return { newVolume: newVolume } 
  }

  /**  Clear queue.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupClearQueue (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.flush()
    return {}
  }

  /**  Create a snapshot of the given group of players.
   * @param  {object}  node only used for debug and warning
   * @param  {object}  msg incoming message
   * @param  {boolean} [msg.snapVolumes = false] will capture the players volumes
   * @param  {boolean} [msg.snapMutestates = false] will capture the players mutestates
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player
   *
   * @return {promise}  {payload: snap} snap see createGroupSnapshot
   *
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupCreateSnapshot (node, msg, stateName, cmdName, sonosPlayer) {
    // validate msg properties
    const options = { snapVolumes: false, snapMutestates: false } // default
    if (isValidProperty(msg, ['snapVolumes'])) {
      if (typeof msg.snapVolumes !== 'boolean') {
        throw new Error(`${NRCSP_ERRORPREFIX}: snapVolumes indicator (msg.snapVolumes) is not boolean`)
      }
      options.snapVolumes = msg.snapVolumes
    }
    if (isValidProperty(msg, ['snapMutestates'])) {
      if (typeof msg.snapVolumes !== 'boolean') {
        throw new Error(`${NRCSP_ERRORPREFIX}: snapMutestates indicator (msg.snapMutestates) is not boolean`)
      }
      options.snapMutestates = msg.snapMutestates
    }

    // validate msg.playerName - error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const sonosPlayermembers = []
    let sonosSinglePlayer = {}
    for (let index = 0; index < groupData.members.length; index++) {
      sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
      sonosSinglePlayer.baseUrl = groupData.members[index].baseUrl
      sonosPlayermembers.push(sonosSinglePlayer)
    }
    const snap = await createGroupSnapshot(node, sonosPlayermembers, options)
    return { payload: snap }
  }

  /**  Group create volume snap shot (used for adjust group volume)
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupCreateVolumeSnapshot (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'SnapshotGroupVolume',
      { InstanceID: 0 }) // 0 stands for coordinator
    
    return {}
  }

  /**  Cancel group sleep timer.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupCancelSleeptimer (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'ConfigureSleepTimer',
      { InstanceID: 0, NewSleepTimerDuration: '' }) 
    return {}
  }

  /**  Get group transport actions.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: transportActions}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetTransportActions (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // 0 stands for coordinator
    const actions = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'GetCurrentTransportActions',
      { InstanceID: 0 })
    
    return { payload: actions }
  }

  /**  Get group crossfade mode.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: crossfade mode} on/off
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetCrossfadeMode (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    // 0 stands for coordinator
    const state = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'GetCrossfadeMode',
      { InstanceID: 0 }) 
    
    return { payload: (state === '1' ? 'on' : 'off') }
  }

  /**
   * Group member data. 

   * @typedef {Object} GroupMember
   * @property {string} urlHostname hostname such as "192.168.178.35"
   * @property {number} urlPort=1400 port
   * @property {string} baseUrl base url such as "http://192.167.178.35:1400"
   * @property {string} uuid such as "RINCON_000E58FE3AEA01400" 
   * @property {string} sonosName SONOS-Playername such as "Bad"
   * @property {boolean} invisible is invisible (example: stereo pair)
   */

  /**  Get array of group member - this group.
   * 
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName=using sonosPlayer] SONOS-Playername. Overrules sonosPlayer
   * @param  {string}  stateName=payload  in compatibility mode: topic, not used
   * @param  {string}  cmdName=topic in compatibility mode: payload, not used
   * @param  {object}  sonosPlayer Sonos player from config node
   *
   * @return {Promise<GroupMember[]>}  with key payload!
   *
   * @throws {error} from methods validatedGroupProperties, getGroupMemberDataV2
   */
  async function groupGetMembers (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    return { payload: groupData.members }
  }

  /**  Get group mute.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: muteState} on/off
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetMute (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // 0 stands for coordinator
    const state = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'GetGroupMute',
      { InstanceID: 0 }) 
    
    return { payload: (state === '1' ? 'on' : 'off') }
  }

  /**  Get the playback state of that group, the specified player belongs to.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} { payload: state }
   * state: { STOPPED: 'stopped', PLAYING: 'playing', PAUSED_PLAYBACK: 'paused', TRANSITIONING: 'transitioning', NO_MEDIA_PRESENT: 'no_media' }
   * First is the SONOS response, that is translated by node-sonos.
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetPlaybackstate (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    const playbackstate = await sonosCoordinator.getCurrentState()
    return { payload: playbackstate }
  }

  /**  Get group SONOS queue - the SONOS queue of the coordinator.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update msg. msg.payload = array of queue items as object
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetQueue (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const coordinatorIndex = 0
    const queueItems = await getQueueV2(groupData.members[coordinatorIndex].baseUrl)
    return { payload: queueItems }
  }

  /**  Get group sleeptimer.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: crossfade mode} hh:mm:ss
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetSleeptimer (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // 0 stands for coordinator, returns and object!
    const sleeptimer = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'GetRemainingSleepTimerDuration',
      { InstanceID: 0 }) 
    
    return { payload: (sleeptimer.RemainingSleepTimerDuration === '' ? 'no time set' : sleeptimer.RemainingSleepTimerDuration) }
  }

  /**  Get state (see return) of that group, the specified player belongs to.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} { see return }
   * state: { STOPPED: 'stopped', PLAYING: 'playing', PAUSED_PLAYBACK: 'paused', TRANSITIONING: 'transitioning', NO_MEDIA_PRESENT: 'no_media' }
   * queue mode: 'NORMAL', 'REPEAT_ONE', 'REPEAT_ALL', 'SHUFFLE', 'SHUFFLE_NOREPEAT', 'SHUFFLE_REPEAT_ONE'
   * First is the SONOS response, that is translated by node-sonos.
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetState (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    sonosCoordinator.baseUrl = groupData.members[0].baseUrl
    const playbackstate = await sonosCoordinator.getCurrentState()
    
    const state = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'GetGroupMute',
      { InstanceID: 0 }) 
    const muteState = (state === '1' ? 'on' : 'off')

    const volume = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'GetGroupVolume',
      { InstanceID: 0 }) 

    // get current media data and extract queueActivated
    const mediaData = await sonosCoordinator.avTransportService().GetMediaInfo()
    if (!isTruthyAndNotEmptyString(mediaData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} current media data is invalid`)
    }
    let uri = '' // set as default if not available
    if (isValidPropertyNotEmptyString(mediaData, ['CurrentURI'])) {
      uri = mediaData.CurrentURI
    }
    const queueActivated = uri.startsWith('x-rincon-queue')
    const tvActivated = uri.startsWith('x-sonos-htastream')

    // queue mode is in parameter PlayMode
    const transportSettings = await executeActionV6(sonosCoordinator.baseUrl,
      '/MediaRenderer/AVTransport/Control', 'GetTransportSettings',
      { InstanceID: 0 })
    const queueMode = transportSettings.PlayMode

    return {
      payload: {
        playbackstate: playbackstate,
        coordinatorName: groupData.members[0].sonosName, // 0 stands for coordinator
        volume: volume,
        muteState: muteState,
        tvActivated: tvActivated,
        queueActivated: queueActivated,
        queueMode: queueMode,
        members: groupData.members,
        size: groupData.members.length,
        id: groupData.groupId,
        name: groupData.groupName
      }
    }
  }

  /**  Get group track and media and position info.
   * @param  {object}  node - used for debug and warning
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: media: {object}, trackInfo: {object}, positionInfo: {object}, queueActivated: true/false
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetTrackPlus (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    sonosCoordinator.baseUrl = groupData.members[0].baseUrl

    // get currentTrack data and extract artist, title. Add baseUrl to albumArtURL.
    const trackData = await sonosCoordinator.currentTrack()
    let artist = 'unknown' // as default
    let title = 'unknown' // as default
    let albumArtUri = ''
    if (!isTruthyAndNotEmptyString(trackData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} current track data is invalid`)
    }
    if (isValidPropertyNotEmptyString(trackData, ['albumArtURI'])) {
      node.debug('got valid albumArtURI')
      albumArtUri = trackData.albumArtURI
      if (typeof albumArtUri === 'string' && albumArtUri.startsWith('/getaa')) {
        albumArtUri = sonosPlayer.baseUrl + albumArtUri
        delete trackData.albumArtURI
      } 
    }
    // extract artist and title if available
    if (!isValidPropertyNotEmptyString(trackData, ['artist'])) {
      // missing artist: TuneIn provides artist and title in title field
      if (!isValidPropertyNotEmptyString(trackData, ['title'])) {
        node.debug('Warning: no artist, no title', 'received-> ' + JSON.stringify(trackData))
      } else {
        if (trackData.title.indexOf(' - ') > 0) {
          node.debug('split data to artist and title')
          artist = trackData.title.split(' - ')[0] // 0 stands for coordinator
          title = trackData.title.split(' - ')[1]
        } else {
          node.debug('Warning: invalid combination artist title receive')
          title = trackData.title
        }
      }
    } else {
      artist = trackData.artist
      if (!isValidPropertyNotEmptyString(trackData, ['title'])) {
        // title unknown - use unknown
      } else {
        node.debug('got artist and title')
        title = trackData.title
      }
    }
    node.debug('got valid song info')

    // get current media data and extract queueActivated, radioId
    const mediaData = await sonosCoordinator.avTransportService().GetMediaInfo()
    if (!isTruthyAndNotEmptyString(mediaData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} current media data is invalid`)
    }
    let uri = ''
    if (isValidPropertyNotEmptyString(mediaData, ['CurrentURI'])) {
      uri = mediaData.CurrentURI
    }
    const queueActivated = uri.startsWith('x-rincon-queue')
    const radioId = getRadioId(uri)
    
    let sid = getMusicServiceId(uri)
    
    // get station uri for all "x-sonosapi-stream"
    let stationArtUri = ''
    if (uri.startsWith('x-sonosapi-stream')) {
      stationArtUri = sonosCoordinator.baseUrl + '/getaa?s=1&u=' + uri
    }

    // get current position data
    const positionData = await sonosCoordinator.avTransportService().GetPositionInfo()
    if (!isTruthyAndNotEmptyString(positionData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} current position data is invalid`)
    }

    if (isValidPropertyNotEmptyString(positionData, ['TrackURI'])) {
      const trackUri = positionData.TrackURI
      if (sid === '') {
        sid = getMusicServiceId(trackUri)
      }
    }
    const serviceName = getMusicServiceName(sid)

    return {
      payload: {
        trackData: trackData,
        artist: artist,
        title: title,
        artUri: albumArtUri,
        mediaData: mediaData,
        queueActivated: queueActivated,
        radioId: radioId,
        serviceId: sid,
        serviceName: serviceName,
        stationArtUri: stationArtUri,
        positionData: positionData
      }
    }
  }

  /**  Get group volume.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @output {promise}  { payload: groupVolume}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupGetVolume (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // 0 stands for coordinator
    const volume = await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'GetGroupVolume',
      { InstanceID: 0 }) 
    
    return { payload: volume }
  }

  /**  Play next track on given group of players.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupNextTrack (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.next()
    return {}
  }

  /**  Pause playing in that group, the specified player belongs to.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupPause (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.pause()
    return {}
  }

  /**  Starts playing content. Content must have been set before.
   * @param  {object}         node not used
   * @param  {object}         msg incoming message
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {number}         [msg.sameVolume] shall all players play at same volume level. If missing all group members play at same volume level
   * @param  {string}         [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}         stateName not used
   * @param  {string}          cmdName not used
   * @param  {object}         sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupPlay (node, msg, stateName, cmdName, sonosPlayer) {
    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    if (validated.sameVolume === false && groupData.members.length === 1) {
      throw new Error(`${NRCSP_ERRORPREFIX} msg.sameVolume is nonsense: player is standalone`)
    }
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.play()

    if (validated.volume !== -1) {
      let sonosSinglePlayer
      if (validated.sameVolume) {
        for (let index = 0; index < groupData.members.length; index++) {
          sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
          // baseUrl not needed
          await sonosSinglePlayer.setVolume(validated.volume)
        }
      } else {
        sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
        // baseUrl not needed
        await sonosSinglePlayer.setVolume(validated.volume)
      }
    }
    return {}
  }

  /**  Play data being exported form My Sonos (uri/metadata) on a given group of players
   * @param  {object}   node not used
   * @param  {object}   msg incoming message
   * @param  {string}   msg[stateName] content to be played
   * @param  {string}   msg[stateName].uri uri to be played/queued
   * @param  {boolean}  msg[stateName].queue indicator: has to be queued
   * @param  {string}   [msg[stateName].metadata] metadata in case of queue = true
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {boolean}  [msg.sameVolume] shall all players play at same volume level. If missing all group members play at same volume level
   * @param  {boolean}  [msg.clearQueue] if true and export.queue = true the queue is cleared. Default is true.
   * @param  {string}   [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}   stateName: payload - in compatibility mode: topic
   * @param  {string}    cmdName not used
   * @param  {object}   sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws  any functions throws error and explicit throws
   */
  async function groupPlayExport (node, msg, stateName, cmdName, sonosPlayer) {
    // simple validation of export and activation

    const exportData = msg[stateName]
    if (!isValidPropertyNotEmptyString(exportData, ['uri'])) {
      throw new Error(`${NRCSP_ERRORPREFIX} uri is missing`)
    }
    if (!isValidPropertyNotEmptyString(exportData, ['queue'])) {
      throw new Error(`${NRCSP_ERRORPREFIX} queue identifier is missing`)
    }

    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    if (validated.sameVolume === false && groupData.members.length === 1) {
      throw new Error(`${NRCSP_ERRORPREFIX} msg.sameVolume is nonsense: player is standalone`)
    }

    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    sonosCoordinator.baseUrl = groupData.members[0].baseUrl

    if (exportData.queue) {
      if (validated.clearQueue) {
        await sonosCoordinator.flush()
      }
      await sonosCoordinator.queue({ uri: exportData.uri, metadata: exportData.metadata })
      await sonosCoordinator.selectQueue()
    } else {
      await sonosCoordinator.setAVTransportURI(exportData.uri)
    }
    if (validated.volume !== -1) {
      let sonosSinglePlayer
      if (validated.sameVolume) {
        for (let index = 0; index < groupData.members.length; index++) {
          sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
          // baseUrl not needed
          await sonosSinglePlayer.setVolume(validated.volume)
        }
      } else {
        sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
        // baseUrl not needed
        await sonosSinglePlayer.setVolume(validated.volume)
      }
    }
    return {}
  }

  /**  Play notification on a given group of players. Group topology will not being touched.
   * @param  {object}  node only used for debug and warning
   * @param  {object}  msg incoming message
   * @param  {string}  msg[stateName] notification uri.
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {boolean} [msg.sameVolume] shall all players play at same volume level. If missing all group members play at same volume level
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  [msg.duration] duration of notification hh:mm:ss - default is calculation, if that fails then 00:00:05
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   * Hint:
   *  While playing a notification (start .. to end + 2 seconds)
   *     there should not be send another request to this group.
   */
  async function groupPlayNotification (node, msg, stateName, cmdName, sonosPlayer) {
    // payload uri is required.
    const validatedUri = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'uri', NRCSP_ERRORPREFIX)

    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const options = { // set defaults
      uri: validatedUri,
      volume: validated.volume,
      sameVolume: validated.sameVolume,
      automaticDuration: true,
      duration: '00:00:05' // in case automaticDuration does not work - 5 seconds
    }

    // update options.duration - get info from SONOS
    if (isValidProperty(msg, ['duration'])) {
      if (typeof msg.duration !== 'string') {
        throw new Error(`${NRCSP_ERRORPREFIX} duration (msg.duration) is not a string`)
      }
      if (!REGEX_TIME.test(msg.duration)) {
        throw new Error(`${NRCSP_ERRORPREFIX} duration (msg.duration) is not format hh:mm:ss`)
      }
      options.duration = msg.duration
      options.automaticDuration = false
    }

    const membersPlayerPlus = []
    let sonosSinglePlayer = {}
    for (let index = 0; index < groupData.members.length; index++) {
      sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
      sonosSinglePlayer.baseUrl = groupData.members[index].baseUrl
      membersPlayerPlus.push(sonosSinglePlayer)
    }
    await playGroupNotification(node, membersPlayerPlus, options)
    return {}
  }

  /**  Play not empty queue.
   * @param  {object}         node not used
   * @param  {object}         msg incoming message
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {number}         [msg.sameVolume] shall all players play at same volume level. If missing all group members play at same volume level
   * @param  {string}         [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}         stateName not used
   * @param  {string}         cmdName not used
   * @param  {object}         sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupPlayQueue (node, msg, stateName, cmdName, sonosPlayer) {
    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    if (validated.sameVolume === false && groupData.members.length === 1) {
      throw new Error(`${NRCSP_ERRORPREFIX} msg.sameVolume is nonsense: player is standalone`)
    }
    
    const coordinatorIndex = 0
    const queueData = await getQueueV2(groupData.members[coordinatorIndex].baseUrl)
    if (queueData.length === 0) {
      // queue is empty
      throw new Error(`${NRCSP_ERRORPREFIX} queue is empty`)
    }

    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.selectQueue()

    if (validated.volume !== -1) {
      let sonosSinglePlayer
      if (validated.sameVolume) {
        for (let index = 0; index < groupData.members.length; index++) {
          sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
          // baseUrl not needed
          await sonosSinglePlayer.setVolume(validated.volume)
        }
      } else {
        sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
        // baseUrl not needed
        await sonosSinglePlayer.setVolume(validated.volume)
      }
    }
    return {}
  }

  /**  Play a given snapshot on the given group of players.
   * @param  {object}  node only used for debug and warning
   * @param  {object}  msg incoming message
   * @param  {object}  msg[stateName] snapshot - output form groupCreateSnapshot
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   * Assumption: payload is valid - not checked.
   */
  async function groupPlaySnapshot (node, msg, stateName, cmdName, sonosPlayer) {
    const pPath = []
    pPath.push(stateName)
    if (isValidProperty(msg, pPath)) {
      if (typeof msg[stateName] !== 'object') {
        throw new Error(`${NRCSP_ERRORPREFIX}: snapshot (msg.${stateName}) is not object`)
      }
    } else {
      throw new Error(`${NRCSP_ERRORPREFIX}: snapshot (msg.${stateName}) is missing`)
    }
    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const membersPlayerPlus = []
    let sonosSinglePlayer = {}
    for (let index = 0; index < groupData.members.length; index++) {
      sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
      sonosSinglePlayer.baseUrl = groupData.members[index].baseUrl
      membersPlayerPlus.push(sonosSinglePlayer)
    }
    const snap = msg[stateName]
    await restoreGroupSnapshot(node, membersPlayerPlus, snap)
    if (snap.wasPlaying) {
      await membersPlayerPlus[0].play() // 0 stands for coordinator
    }
    return {}
  }

  /**  Plays stream using http such as http://www.fritz.de/live.m3u, https://live.radioarabella.de
   * 
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.payload* valid uri starting with http:// or https:// (*: compatibility mode: topic)
   * @param  {(number|string)}  [msg.volume=unchanged] new volume
   * @param  {boolean} [msg.sameVolume=true] force all players to play at same volume level.
   * @param  {string}  [msg.playerName=using sonosPlayer] SONOS-Playername. Overrules sonosPlayer
   * @param  {string}  stateName=payload  in compatibility mode: topic
   * @param  {string}  cmdName=topic in compatibility mode: payload
   * @param  {object}  sonosPlayer Sonos player from config node
   *
   * @return {Promise<boolean>} always true
   * @throws {error} if msg.sameValue true and standalone player
   * @throws {error} NRCSP error from methods validatedGroupProperties, getGroupMemberDataV2, stringValidRegex
   * @throws {error} from node-sonos setAVTransportURI and setVolume
   */
  async function groupPlayStreamHttpV2 (node, msg, stateName, cmdName, sonosPlayer) {
    // payload uri is required.
    let validatedUri = stringValidRegex(msg, stateName, REGEX_HTTP, 'uri', NRCSP_ERRORPREFIX)
  
    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    if (validated.sameVolume === false && groupData.members.length === 1) {
      throw new Error(`${NRCSP_ERRORPREFIX} msg.sameVolume is nonsense: player is standalone`)
    }

    validatedUri = 'x-rincon-mp3radio://'  + validatedUri
    const coordinatorBaseUrl= groupData.members[0].baseUrl
    await executeActionV6(coordinatorBaseUrl,'/MediaRenderer/AVTransport/Control', 'SetAVTransportURI',
      { InstanceID: 0, CurrentURI: validatedUri, CurrentURIMetaData: '' })
    await executeActionV6(coordinatorBaseUrl, '/MediaRenderer/AVTransport/Control', 'Play',
      { InstanceID: 0, Speed: '1' })

    if (validated.volume !== -1) {
      let sonosSinglePlayer
      if (validated.sameVolume) {
        for (let index = 0; index < groupData.members.length; index++) {
          sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
          // baseUrl not needed
          await sonosSinglePlayer.setVolume(validated.volume)
        }
      } else {
        sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
        // baseUrl not needed
        await sonosSinglePlayer.setVolume(validated.volume)
      }
    }
    return {}
  }

  /**  Play a specific track in queue. Queue must not be empty.
   * @param  {object}         node not used
   * @param  {object}         msg incoming message
   * @param  {string/number}  msg[stateName] position of track in queue. 1 ... queue length.
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {boolean}        [msg.sameVolume] shall all players play at same volume level. If missing all group members play at same volume level
   * @param  {string}         [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}         stateName default: payload - in compatibility mode: topic
   * @param  {string}         cmdName not used
   * @param  {object}         sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupPlayTrack (node, msg, stateName, cmdName, sonosPlayer) {
    // get the playerName
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const coordinatorIndex = 0
    const queueItems = await getQueueV2(groupData.members[coordinatorIndex].baseUrl)
    const lastTrackInQueue = queueItems.length
    if (lastTrackInQueue === 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} queue is empty`)
    }
    // payload position is required
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    const validatedPosition = string2ValidInteger(msg, stateName, 1, lastTrackInQueue, 'position in queue', NRCSP_ERRORPREFIX)
    await sonosCoordinator.selectQueue()
    await sonosCoordinator.selectTrack(validatedPosition)

    if (validated.volume !== -1) {
      let sonosSinglePlayer
      if (validated.sameVolume) {
        for (let index = 0; index < groupData.members.length; index++) {
          sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
          // baseUrl not needed
          await sonosSinglePlayer.setVolume(validated.volume)
        }
      } else {
        sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
        // baseUrl not needed
        await sonosSinglePlayer.setVolume(validated.volume)
      }
    }
    return {}
  }

  /**  Play tuneIn station. Optional set volume, use playerName.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg[stateName] TuneIn id
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {boolean} [msg.sameVolume] shall all players play at same volume level. If missing all group members play at same volume level
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws  all from validatedGroupProperties
   *          all from getGroupMemberDataV2
   *          if msg.sameVolume === false and player == standalone because non sense.
   */
  async function groupPlayTuneIn (node, msg, stateName, cmdName, sonosPlayer) {
    // payload radio id is required
    const validatedRadioId = stringValidRegex(msg, stateName, REGEX_RADIO_ID, 'radio id', NRCSP_ERRORPREFIX)
    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    if (validated.sameVolume === false && groupData.members.length === 1) {
      throw new Error(`${NRCSP_ERRORPREFIX} msg.sameVolume is nonsense: player is standalone`)
    }
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.playTuneinRadio(validatedRadioId)

    if (validated.volume !== -1) {
      let sonosSinglePlayer
      if (validated.sameVolume) {
        for (let index = 0; index < groupData.members.length; index++) {
          sonosSinglePlayer = new Sonos(groupData.members[index].urlHostname)
          // baseUrl not needed
          await sonosSinglePlayer.setVolume(validated.volume)
        }
      } else {
        sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
        // baseUrl not needed
        await sonosSinglePlayer.setVolume(validated.volume)
      }
    }
    return {}
  }

  /**  Play previous track on given group of players.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupPreviousTrack (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.previous()
    return {}
  }

  /**  Queue uri.
   * @param  {object}       node not used
   * @param  {object}       msg incoming message
   * @param  {string/number}msg.[stateName] valid uri
   * @param  {string}       [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}       stateName default: payload - in compatibility mode: topic
   * @param  {string}       cmdName not used
   * @param  {object}       sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupQueueUri (node, msg, stateName, cmdName, sonosPlayer) {
    // payload uri is required.
    const validatedUri = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'uri', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.queue(validatedUri)
    return {}
  }

  /**  Queue spotify uri on given group queue.
   * @param  {object}       node not used
   * @param  {object}       msg incoming message
   * @param  {string/number} msg.[stateName] valid uri from spotify
   * @param  {string}       [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}       stateName default: payload - in compatibility mode: topic
   * @param  {string}       cmdName not used
   * @param  {object}       sonosPlayer Sonos player - as default and anchor player
   *
   * Valid examples
   * spotify:track:5AdoS3gS47x40nBNlNmPQ8
   * spotify:album:1TSZDcvlPtAnekTaItI3qO
   * spotify:artistTopTracks:1dfeR4HaWDbWqFHLkxsg1d
   * spotify:user:spotify:playlist:37i9dQZEVXbMDoHDwVN2tF'
   *
   * Caution: Currently only support European region '2311' (US = 3079?)
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupQueueUriFromSpotify (node, msg, stateName, cmdName, sonosPlayer) {
    // payload uri is required.
    const validatedUri = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'spotify uri', NRCSP_ERRORPREFIX)
    if (!(validatedUri.startsWith('spotify:track:') ||
        validatedUri.startsWith('spotify:album:') ||
        validatedUri.startsWith('spotify:artistTopTracks:') ||
        validatedUri.startsWith('spotify:user:spotify:playlist:'))) {
      throw new Error(`${NRCSP_ERRORPREFIX} not supported type of spotify uri`)
    }

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.setSpotifyRegion('2311')
    await sonosCoordinator.queue(validatedUri)
    return {}
  }

  /**  Remove a number of tracks in queue.
   * @param  {object}         node not used
   * @param  {object}         msg incoming message
   * @param  {string/number}  msg.[stateName] number of track in queue. 1 ... queue length.
   * @param  {number/string}  msg.numberOfTracks number of track 1 ... queue length. If missing 1.
   * @param  {string}         [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}         stateName default: payload - in compatibility mode: topic
   * @param  {string}         cmdName not used
   * @param  {object}         sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupRemoveTracks (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // get the number of tracks in queue - should be > 0
    const coordinatorIndex = 0
    const queueItems = await getQueueV2(groupData.members[coordinatorIndex].baseUrl)
    const lastTrackInQueue = queueItems.length
    if (lastTrackInQueue === 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} queue is empty`)
    }

    // payload track position is required.
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    const validatedPosition = string2ValidInteger(msg, stateName, 1, lastTrackInQueue, 'position in queue', NRCSP_ERRORPREFIX)
    const validatedNumberOfTracks = string2ValidInteger(msg, 'numberOfTracks', 1, lastTrackInQueue, 'number of tracks', NRCSP_ERRORPREFIX, 1)
    await sonosCoordinator.removeTracksFromQueue(validatedPosition, validatedNumberOfTracks)
    return {}
  }

  /**  Save SONOS queue to Sonos playlist.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] title of Sonos playlist.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSaveQueueToSonosPlaylist (node, msg, stateName, cmdName, sonosPlayer) {
    // payload title search string is required.
    const validatedTitle = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'title', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const coordinatorIndex = 0
    const queueItems = await getQueueV2(groupData.members[coordinatorIndex].baseUrl)
    if (queueItems.length === 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} queue is empty`)
    }    
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'SaveQueue',
      { InstanceID: 0, Title: validatedTitle, ObjectID: '' }) // 0 stands for coordinator

    return {}
  }

  /**  Group seek to specific time.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] hh:mm:ss time in song.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSeek (node, msg, stateName, cmdName, sonosPlayer) {
    // payload seek time is required.
    const validTime = stringValidRegex(msg, stateName, REGEX_TIME, 'seek time', NRCSP_ERRORPREFIX)
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'Seek',
      { InstanceID: 0, Target: validTime, Unit: 'REL_TIME' })
    return {}
  }

  /**  Group seek with delta time to specific time.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] +/- hh:mm:ss time in song.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSeekDelta (node, msg, stateName, cmdName, sonosPlayer) {
    // payload seek time is required.
    const validTime = stringValidRegex(msg, stateName, REGEX_TIME_DELTA, 'relative seek time', NRCSP_ERRORPREFIX)
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'Seek',
      { InstanceID: 0, Target: validTime, Unit: 'TIME_DELTA' })
    
    return {}
  }

  /**  Set group crossfade on/off.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] on/off.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSetCrossfade (node, msg, stateName, cmdName, sonosPlayer) {
    // payload crossfade sate is required.
    let newState = isOnOff(msg, stateName, 'crosssfade state', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'SetCrossfadeMode',
      { InstanceID: 0, CrossfadeMode: newState }) 

    return {}
  }

  /**  Set group mute state.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] on/off.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSetMute (node, msg, stateName, cmdName, sonosPlayer) {
    // payload mute state is required.
    const newState = isOnOff(msg, stateName, 'mute state', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'SetGroupMute',
      { InstanceID: 0, DesiredMute: newState })
    
    return {}
  }

  /**  Set group queuemode - queue must being activated and must not be empty.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] queue modes - may be mixed case
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSetQueuemode (node, msg, stateName, cmdName, sonosPlayer) {
    // payload queuemode is required.
    const newState = stringValidRegex(msg, stateName, REGEX_QUEUEMODES, 'queue mode', NRCSP_ERRORPREFIX)

    // check queue is not empty and activated
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const coordinatorIndex = 0
    const queueItems = await getQueueV2(groupData.members[coordinatorIndex].baseUrl)
    if (queueItems.length === 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} queue is empty`)
    }
    const sonosCoordinator = new Sonos((groupData.members[0].urlHostname))
    sonosCoordinator.baseUrl = groupData.members[0].urlHostname
    const mediaData = await sonosCoordinator.avTransportService().GetMediaInfo()
    if (!isTruthyAndNotEmptyString(mediaData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} current media data is invalid`)
    }
    if (!isValidPropertyNotEmptyString(mediaData, ['CurrentURI'])) {
      throw new Error(`${NRCSP_ERRORPREFIX} CurrentUri is invalid`)
    }
    const uri = mediaData.CurrentURI
    if (!uri.startsWith('x-rincon-queue')) {
      throw new Error(`${NRCSP_ERRORPREFIX} queue is not activated`)
    }
    // SONOS only accepts uppercase!
    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'SetPlayMode',
      { InstanceID: 0, NewPlayMode: newState.toUpperCase() }) 
    
    return {}
  }

  /**  Set group sleep timer.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] hh:mm:ss time in song.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSetSleeptimer (node, msg, stateName, cmdName, sonosPlayer) {
    // payload sleep time is required.
    const validTime = stringValidRegex(msg, stateName, REGEX_TIME, 'timer duration', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'ConfigureSleepTimer',
      { InstanceID: 0, NewSleepTimerDuration: validTime }) 
    
    return {}
  }

  /**  Group set volume (all player same volume)
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string/number}  msg.[stateName] new volume
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupSetVolume(node, msg, stateName, cmdName, sonosPlayer) {
    const newVolume = string2ValidInteger(msg, stateName, -100, +100, 'new volume', NRCSP_ERRORPREFIX)
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    // no check - always returns true, 0 stands for coordinator
    await executeActionV6(groupData.members[0].baseUrl,
      '/MediaRenderer/GroupRenderingControl/Control', 'SetGroupVolume',
      { InstanceID: 0, DesiredVolume: newVolume }) 

    return {}
  }

  /**  Stop playing in that group, the specified player belongs to.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupStop (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.stop()
    return {}
  }

  /**  Toggle playback on given group of players.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function groupTogglePlayback (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    // baseUrl not needed
    await sonosCoordinator.togglePlayback()
    return {}
  }

  /**  Create a new group in household. 
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] comma separated list of playerNames, first will become coordinator
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} array of all group array of members :-)
   *
   * @throws any functions throws error and explicit throws
   */
  async function householdCreateGroup (node, msg, stateName, cmdName, sonosPlayer) {
    
    const validatedPlayerList = stringValidRegex(msg, stateName, REGEX_CSV, 'player list', NRCSP_ERRORPREFIX)
    const newGroupPlayerArray = validatedPlayerList.split(',')

    // verify all are unique
    const uniqueArray = newGroupPlayerArray.filter((x, i, a) => a.indexOf(x) == i)
    if (uniqueArray.length < newGroupPlayerArray.length) {
      throw new Error(`${NRCSP_ERRORPREFIX} List includes a player multiple times`)
    }
    
    // get groups with members and convert multi dimensional array to simple array where objects have new property groupIndex, memberIndex
    const householdPlayerList = await getAllPlayerList(sonosPlayer)


    // validate all player names in newGroupPlayerArray and get index of new coordinator
    let indexInList
    let indexNewCoordinator
    for (let i = 0; i < newGroupPlayerArray.length; i++) {
      indexInList = householdPlayerList.findIndex(p => p.sonosName === newGroupPlayerArray[i]) 
 
      if (indexInList === -1) {
        throw new Error(`${NRCSP_ERRORPREFIX} Could not find player: ${newGroupPlayerArray[i]}`)
      }
      if (i === 0) {
        indexNewCoordinator = indexInList
      }
    }
    let coordinatorRincon = `x-rincon:${householdPlayerList[indexNewCoordinator].uuid}` 

    // Is new coordinator already the coordinator in its group? Then use this group and adjust
    if (householdPlayerList[indexNewCoordinator].isCoordinator) { // means is a coordinator
      // modify this group (remove those not needed and add some)
      let found
      for (let i = 0; i < householdPlayerList.length; i++) {
        // should this player be in group?
        found = newGroupPlayerArray.indexOf(householdPlayerList[i].sonosName)
        if (found === -1) {
          // remove if in new coordinator group
          if (householdPlayerList[i].groupIndex === householdPlayerList[indexNewCoordinator].groupIndex) {
            // leave group, no check - always returns true
            await executeActionV6(householdPlayerList[i].baseUrl,
              '/MediaRenderer/AVTransport/Control', 'BecomeCoordinatorOfStandaloneGroup',
              { InstanceID: 0 })
          }
        } else {
          if (householdPlayerList[i].groupIndex !== householdPlayerList[indexNewCoordinator].groupIndex) {
            // no check - always returns true. Using SetAVTransportURI as AddMember does not work
            await executeActionV6(householdPlayerList[i].baseUrl,
              '/MediaRenderer/AVTransport/Control', 'SetAVTransportURI',
              { InstanceID: 0, CurrentURI: coordinatorRincon, CurrentURIMetaData: '' })
          }
        }
      }
    } else {
      await executeActionV6(householdPlayerList[indexNewCoordinator].baseUrl,
        '/MediaRenderer/AVTransport/Control', 'BecomeCoordinatorOfStandaloneGroup', { InstanceID: 0 })
      
      await setTimeout[Object.getOwnPropertySymbols(setTimeout)[0]](500) // because it takes time to BecomeCoordinator
      let indexPlayer
      
      for (let i = 1; i < newGroupPlayerArray.length; i++) { // start with 1
        indexPlayer = householdPlayerList.findIndex(p => p.sonosName === newGroupPlayerArray[i])
        // no check - always returns true. Using SetAVTransportURI as AddMember does not work
        await executeActionV6(householdPlayerList[indexPlayer].baseUrl,
          '/MediaRenderer/AVTransport/Control', 'SetAVTransportURI',
          { InstanceID: 0, CurrentURI: coordinatorRincon, CurrentURIMetaData: '' })
      }
    }
    return {}
  }

  /**  Create a stereo pair of players. Right one will be hidden! Is only support for some type of SONOS player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] - left player, will be visible
   * @param  {string}  msg.playerNameRight - right player, will become invisible
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   * Caution: In executeAction it should be left: playerLeftBaseUrl
   *
   */
  async function householdCreateStereoPair (node, msg, stateName, cmdName, sonosPlayer) {
    // both player are required
    const playerLeft = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'player name left', NRCSP_ERRORPREFIX)
    const playerRight = stringValidRegex(msg, 'playerNameRight', REGEX_ANYCHAR, 'player name right', NRCSP_ERRORPREFIX)

    // verify that playerNames are valid and get the uuid
    const allGroupsData = await sonosPlayer.getAllGroups()
    let playerRightUuid = ''
    let playerLeftUuid = ''
    let playerLeftBaseUrl
    if (!isTruthyAndNotEmptyString(allGroupsData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} all groups data undefined`)
    }
    if (!Array.isArray(allGroupsData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} all groups data is not array`)
    }
    // allGroupsData is an array of groups. Each group has properties ZoneGroupMembers, host (IP Address), port, baseUrl, coordinator (uuid)
    // ZoneGroupMembers is an array of all members with properties ip address and more
    let name
    for (let groupIndex = 0; groupIndex < allGroupsData.length; groupIndex++) {
      for (let memberIndex = 0; memberIndex < allGroupsData[groupIndex].ZoneGroupMember.length; memberIndex++) {
        name = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].ZoneName
        if (name === playerRight) {
          playerRightUuid = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].UUID
        }
        if (name === playerLeft) {
          playerLeftUuid = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].UUID
          const playerUrl = new URL(allGroupsData[groupIndex].ZoneGroupMember[memberIndex].Location)
          playerLeftBaseUrl = `http://${playerUrl.host}`
        }
      }
    }
    if (playerLeftUuid === '') {
      throw new Error(`${NRCSP_ERRORPREFIX} player name left was not found`)
    }
    if (playerRightUuid === '') {
      throw new Error(`${NRCSP_ERRORPREFIX} player name right was not found`)
    }
    
    // no check - always returns true
    await executeActionV6(playerLeftBaseUrl,
      '/DeviceProperties/Control', 'CreateStereoPair',
      { ChannelMapSet: `${playerLeftUuid}:LF,LF;${playerRightUuid}:RF,RF` })
    
    return {}
  }

  /**  Get household groups. Ignore hidden player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} array of all group array of members :-)
   *
   * @throws any functions throws error and explicit throws
   */
  async function householdGetGroups (node, msg, stateName, cmdName, sonosPlayer) {
    const allGroupsData = await sonosPlayer.getAllGroups()
    const allGroupsArray = []
    let group
    for (let groupIndex = 0; groupIndex < allGroupsData.length; groupIndex++) {
      group = await sortedGroupArray(allGroupsData, groupIndex)
      group = group.filter(member => member.invisible === false)
      allGroupsArray.push(group)
    }
    return { payload: allGroupsArray }
  }

  /**  Get SONOS playlists (limited 200, ObjectID SQ)
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} All sonos playlists as array of objects
   * 
   * @throws any functions throws error and explicit throws
   */
  async function householdGetSonosPlaylists (node, msg, stateName, cmdName, sonosPlayer) {
    
    const sonosPlaylists = await getSonosPlaylistsV2(sonosPlayer.baseUrl)
    return { payload: sonosPlaylists }
  }

  /**  Remove Sonos playlist with given title. (impact on My Sonos and also Sonos playlist list)
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] title of Sonos playlist.
   * @param  {boolean} [msg.ignoreNotExists] if missing assume true
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function householdRemoveSonosPlaylist (node, msg, stateName, cmdName, sonosPlayer) {
    // payload title search string is required.
    const validatedTitle = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'title', NRCSP_ERRORPREFIX)

    let ignoreNotExists = true
    if (isValidProperty(msg, ['ignoreNotExists'])) {
      if (typeof msg.ignoreNotExists !== 'boolean') {
        throw new Error(`${NRCSP_ERRORPREFIX}: msg.ignoreNotExists is not boolean`)
      }
      ignoreNotExists = msg.ignoreNotExist
    }

    // using the default player of this node
    const sonosPlaylists = await getSonosPlaylistsV2(sonosPlayer.baseUrl)
  
    // find title in playlist - exact - return id
    let id = ''
    for (var i = 0; i < sonosPlaylists.length; i++) {
      if (sonosPlaylists[i].title === validatedTitle) {
        id = sonosPlaylists[i].id.replace('SQ:', '')
      }
    }
    if (id === '') { // not found
      if (!ignoreNotExists) {
        throw new Error(`${NRCSP_ERRORPREFIX} No Sonos playlist title matching search string.`)
      }
    } else {
      await sonosPlayer.deletePlaylist(id)
    }
    
    return {}
  }

  /**  Separate group in household.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function householdSeparateGroup (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    for (let i = 1; i < groupData.members.length; i++) {  // start with 1 - coordinator is last
      groupData.members[i]

      // no check - always returns true
      await executeActionV6(groupData.members[i].baseUrl,
        '/MediaRenderer/AVTransport/Control', 'BecomeCoordinatorOfStandaloneGroup',
        { InstanceID: 0 })
    }
    return {}
  }

  /**  Separate a stereo pair of players. Right player will become visible again.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] - left player, will be visible
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   */
  async function householdSeparateStereoPair (node, msg, stateName, cmdName, sonosPlayer) {
    // player left is required
    const playerLeft = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'player name left', NRCSP_ERRORPREFIX)

    // verify that playerNames are valid and get the uuid
    const allGroupsData = await sonosPlayer.getAllGroups()
    let playerLeftUuid = ''
    let playerLeftBaseUrl
    let playerRightUuid = ''
    if (!isTruthyAndNotEmptyString(allGroupsData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} all groups data undefined`)
    }
    if (!Array.isArray(allGroupsData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} all groups data is not array`)
    }
    // allGroupsData is an array of groups. Each group has properties ZoneGroupMembers, host (IP Address), port, baseUrl, coordinator (uuid)
    // ZoneGroupMembers is an array of all members with properties ip address and more
    let name
    let playerUuid
    let playerChannelMap
    for (let groupIndex = 0; groupIndex < allGroupsData.length; groupIndex++) {
      for (let memberIndex = 0; memberIndex < allGroupsData[groupIndex].ZoneGroupMember.length; memberIndex++) {
        name = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].ZoneName
        if (name === playerLeft) {
          // Both player have same name. Get the left one
          playerUuid = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].UUID
          playerChannelMap = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].ChannelMapSet
          if (playerChannelMap.startsWith(playerUuid)) {
            playerLeftUuid = playerUuid
            const playerUrl = new URL(allGroupsData[groupIndex].ZoneGroupMember[memberIndex].Location)
            playerLeftBaseUrl = `http://${playerUrl.host}`
            if (!playerChannelMap.includes(';')) {
              throw new Error(`${NRCSP_ERRORPREFIX} channelmap is in error - could not get right uuid`)
            }
            playerRightUuid = playerChannelMap.split(';')[1]
            playerRightUuid = playerRightUuid.replace(':RF,RF', '')
          }
        }
      }
    }
    if (playerLeftUuid === '') {
      throw new Error(`${NRCSP_ERRORPREFIX} player name left was not found`)
    }
    if (playerRightUuid === '') {
      throw new Error(`${NRCSP_ERRORPREFIX} player name right was not found`)
    }

    // no check - always returns true
    await executeActionV6(playerLeftBaseUrl,
      '/DeviceProperties/Control', 'SeparateStereoPair',
      { ChannelMapSet: `${playerLeftUuid}:LF,LF;${playerRightUuid}:RF,RF` })

    return {}
  }

  /**  Household test player connection
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] SONOS player name, required!!!!
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player as anchor player
   *
   * @return {promise} true | false
   *
   * Caution: sonosPlayer can not be used here as default for input.
   * It should be a "always on always available" player.
   *
   * @throws any functions throws error and explicit throws
   */
  async function householdTestPlayerOnline (node, msg, stateName, cmdName, sonosPlayer) {
    // player name is required

    const pPath = []
    pPath.push(stateName)
    if (!isValidProperty(msg, pPath)) {
      throw new Error(`${NRCSP_ERRORPREFIX} player name (msg.${stateName}) is missing/invalid`)
    }
    const playerToBeTested = msg[stateName]
    if (typeof playerToBeTested !== 'string' || playerToBeTested === '') {
      throw new Error(`${NRCSP_ERRORPREFIX} player name (msg.${stateName}) is not string or empty`)
    }
    const allGroupsData = await sonosPlayer.getAllGroups()
    if (!isTruthyAndNotEmptyString(allGroupsData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} all groups data undefined`)
    }
    if (!Array.isArray(allGroupsData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} all groups data is not array`)
    }

    // find our player in groups output
    // allGroupsData is an array of groups. Each group has properties ZoneGroupMembers, host (IP Address), port, baseUrl, coordinator (uuid)
    // ZoneGroupMembers is an array of all members with properties ip address and more
    let name
    for (let groupIndex = 0; groupIndex < allGroupsData.length; groupIndex++) {
      for (let memberIndex = 0; memberIndex < allGroupsData[groupIndex].ZoneGroupMember.length; memberIndex++) {
        name = allGroupsData[groupIndex].ZoneGroupMember[memberIndex].ZoneName
        if (name === playerToBeTested) {
          return { payload: true }
        }
      }
    }
    return { payload: false }
  }

  /**  Play notification on a joiner (in group) specified by sonosPlayer (default) or by playerName.
   * @param  {object}  node only used for debug and warning
   * @param  {object}  msg incoming message
   * @param  {string}  msg[stateName] notification uri.
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {string}  [msg.duration] duration of notification hh:mm:ss - default is calculation, if that fails then 00:00:05
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   * Hints:
   *  While playing a notification (start .. to end + 2 seconds)
   *     there should not be send another request to this player and the group shound be modified
   */
  async function joinerPlayNotification (node, msg, stateName, cmdName, sonosPlayer) {
    // payload notification uri is required.
    const validatedUri = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'uri', NRCSP_ERRORPREFIX)

    // validate msg.playerName, msg.volume, msg.sameVolume -error are thrown
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // verify that player is joiner and not a coordinator
    if (groupData.playerIndex === 0) {
      throw new Error(`${NRCSP_ERRORPREFIX} player (msg.player/node) is not a joiner`)
    }

    // msg.sameVolume is not used (only one player!)
    const options = { // set defaults
      uri: validatedUri,
      volume: validated.volume, // means don't touch
      automaticDuration: true,
      duration: '00:00:05' // in case automaticDuration does not work - 5 seconds
    }

    // update options.duration - get info from SONOS player
    if (isValidProperty(msg, ['duration'])) {
      if (typeof msg.duration !== 'string') {
        throw new Error(`${NRCSP_ERRORPREFIX} duration (msg.duration) is not a string`)
      }
      if (!REGEX_TIME.test(msg.duration)) {
        throw new Error(`${NRCSP_ERRORPREFIX} duration (msg.duration) is not format hh:mm:ss`)
      }
      options.duration = msg.duration
      options.automaticDuration = false
    }

    // The coordinator is being used to capture group status (playing, content, ...)
    const sonosCoordinator = new Sonos(groupData.members[0].urlHostname)
    sonosCoordinator.baseUrl = groupData.members[0].baseUrl

    const sonosJoiner = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosJoiner.baseUrl = groupData.members[groupData.playerIndex].baseUrl
    await playJoinerNotification(node, sonosCoordinator, sonosJoiner, options)
    return {}
  }

  /**  Adjust player volume.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string/number}  msg[stateName] -100 to +100 integer.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerAdjustVolume (node, msg, stateName, cmdName, sonosPlayer) {
    // payload volume is required.
    const adjustVolume = string2ValidInteger(msg, stateName, -100, +100, 'adjust volume', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    // baseUrl not needed
    await sonosSinglePlayer.adjustVolume(adjustVolume)
    return {}
  }

  /**  Player become coordinator of standalone group.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerBecomeStandalone (node, msg, stateName, cmdName, sonosPlayer) {

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl

    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'BecomeCoordinatorOfStandaloneGroup',
      { InstanceID: 0 })

    return {}
  }

  /**  Get player bass.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: bas} type string -10 .. 10
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetBass (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    const bass = await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'GetBass',
      { InstanceID: 0 })
    
    return { payload: bass }
  }

  /**  Get player EQ data.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName is used!
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update msg. msg.payload the Loudness state LED state on/off
   *
   * @throws any functions throws error and explicit throws
   *
   * EQ data are only available for specific players.
   */
  async function playerGetEq (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl

    // verify that player has a TV mode
    const properties = await sonosSinglePlayer.deviceDescription()
    if (!isValidPropertyNotEmptyString(properties, ['modelName'])) {
      throw new Error(`${NRCSP_ERRORPREFIX} Sonos player model name undefined`)
    }
    if (!PLAYER_WITH_TV.includes(properties.modelName)) {
      throw new Error(`${NRCSP_ERRORPREFIX} Selected player does not support TV`)
    }

    let args 
    // no check exist needed as command has already been checked
    if (msg[cmdName] === 'player.get.nightmode') {
      args = { InstanceID: 0, EQType: 'NightMode' }
    } else if (msg[cmdName] === 'player.get.subgain') {
      args = { InstanceID: 0, EQType: 'SubGain' }
    } else if (msg[cmdName] === 'player.get.dialoglevel') {
      args = { InstanceID: 0, EQType: 'DialogLevel' }
    } else {
      // can not happen
    }
    
    let eqData = await executeActionV6(sonosPlayer.baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'GetEQ', args)
    
    if (!isTruthyAndNotEmptyString(eqData)) {
      throw new Error(`${NRCSP_ERRORPREFIX} player response is undefined`)
    }
    if (args.EQType !== 'SubGain') {
      eqData = (eqData === '1' ? 'on' : 'off')
    }

    return { payload: eqData }
  }

  /**  Get player LED state.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update payload the LED state on/off
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetLed (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl
    const ledState = await sonosSinglePlayer.getLEDState()
    if (!isTruthyAndNotEmptyString(ledState)) {
      throw new Error(`${NRCSP_ERRORPREFIX} player response is undefined`)
    }
    return { payload: ledState.toLowerCase() }
  }

  /**  Get player loudness.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update msg. msg.payload the Loudness state LED state on/off
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetLoudness (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const loudness = await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'GetLoudness',
      { InstanceID: 0, Channel: 'Master' })
    
    if (!isTruthyAndNotEmptyString(loudness)) {
      throw new Error(`${NRCSP_ERRORPREFIX} player response is undefined`)
    }
    return { payload: (loudness === '1' ? 'on' : 'off') }
  }

  /**  Get mute state for given player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: muteState} on/off
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetMute (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    const state = await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'GetMute',
      { InstanceID: 0, Channel: 'Master' })

    return { payload: (state === '1'? 'on' : 'off') }
  }

  /**  Get player properties.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update msg. msg.payload the properties object
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetProperties (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl
    const properties = await sonosSinglePlayer.deviceDescription()
    if (properties._) { // strange attribute - remove it
      delete properties._
    }
    properties.uuid = properties.UDN.substring('uuid:'.length)
    properties.playerName = properties.roomName
    if (!isTruthyAndNotEmptyString(properties)) {
      throw new Error(`${NRCSP_ERRORPREFIX} player response is undefined`)
    }
    return { payload: properties }
  }

  /**  Get the SONOS queue of the specified player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update msg. msg.payload = array of queue items as object
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetQueue (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    //const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    //sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl
    const queueItems = await getQueueV2(groupData.members[groupData.playerIndex].baseUrl)
    return { payload: queueItems }
  }

  /**  Get the role and name of a player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} object to update msg. msg.payload to role of player as string.
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetRole (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    let role
    if (groupData.members.length === 1) {
      role = 'standalone'
    } else {
      if (groupData.playerIndex === 0) {
        role = 'coordinator'
      } else {
        role = 'joiner'
      }
    }
    return { payload: role, playerName: groupData.members[groupData.playerIndex].sonosName }
  }

  /**  Get player treble.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {payload: treble} string -10 .. 10
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetTreble (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    const treble = await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'GetTreble',
      { InstanceID: 0 })
    
    return { payload: treble }
  }

  /**  Get volume of given player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @output {payload: volume } range 0 .. 100
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerGetVolume (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const volume = await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'GetVolume',
      { InstanceID: 0, Channel: 'Master' })
    
    return { payload: volume }
  }

  /**  Join a group. The group is being identified in payload (or config node)
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] SONOS name of any player in the group
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * Details: if coordinator: will leave old group and join new group.
   * If already in that group - it will just continue.
   * if coordinator of that group - no action and continue
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerJoinGroup (node, msg, stateName, cmdName, sonosPlayer) {
    // payload a playername in group is required
    const validatedGroupPlayerName = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'group player name', NRCSP_ERRORPREFIX)

    // get coordinator uri/rincon of the target group
    const groupDataToJoin = await getGroupMemberDataV2(sonosPlayer, validatedGroupPlayerName)
    const coordinatorRincon = `x-rincon:${groupDataToJoin.members[0].uuid}`

    // get sonosName and baseUrl of joiner (playerName or config node)
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupDataJoiner = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    if (groupDataJoiner.members[groupDataJoiner.playerIndex].sonosName !== groupDataToJoin.members[0].sonosName) {
      // no check - always returns true. We use SetAVTransport as build in AddMember does not work
      await executeActionV6(groupDataJoiner.members[groupDataJoiner.playerIndex].baseUrl,
        '/MediaRenderer/AVTransport/Control', 'SetAVTransportURI',
        { InstanceID: 0, CurrentURI: coordinatorRincon, CurrentURIMetaData: '' })
    } // else: do nothing - either playerName is already coordinator

    return {}
  }

  /**  Leave a group - means become a standalone player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * Details: if coordinator => will leave group (stop playing), another will take over coordinator role
   * if standalone - no change
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerLeaveGroup (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - return values are ignored
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/AVTransport/Control', 'BecomeCoordinatorOfStandaloneGroup',
      { InstanceID: 0 })
    
    return {}
  }
  ///
  /**  Player play AVTransport uri: LineIn, TV
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg[stateName] extended uri x-***:
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   */
  async function playerPlayAvtransport (node, msg, stateName, cmdName, sonosPlayer) {
    // payload uri is required: eg x-rincon-stream:RINCON_5CAAFD00223601400 for line in
    const validatedUri = stringValidRegex(msg, stateName, REGEX_ANYCHAR, 'uri', NRCSP_ERRORPREFIX)

    // validate msg.playerName, msg.volume
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    // baseUrl not needed
    await sonosSinglePlayer.setAVTransportURI(validatedUri)
    if (validated.volume !== -1) {
      await sonosSinglePlayer.setVolume(validated.volume)
    }
    return {}
  }

  /**  Player play TV
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {number/string}  [msg.volume] volume - if missing do not touch volume
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName not used
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   *
   */
  async function playerPlayTv (node, msg, stateName, cmdName, sonosPlayer) {

    // validate msg.playerName, msg.volume
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    
    // get the device props, check whether TV is supported and extract URI target
    const deviceProps = await sonosSinglePlayer.deviceDescription()
    // extract services and search for controlURL = "/HTControl/Control" - means tv enabled
    const serviceList = deviceProps.serviceList.service
    const found = serviceList.findIndex(service => {
      if (service.controlURL === '/HTControl/Control') return true
    })

    if (found >= 0) {
      // extract RINCON
      const rincon = (deviceProps.UDN).substring('uuid: '.length-1)
      
      // no check - always returns true
      await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
        '/MediaRenderer/AVTransport/Control', 'SetAVTransportURI',
        { InstanceID: 0, CurrentURI: `x-sonos-htastream:${rincon}:spdif`, CurrentURIMetaData: '' })
      
      if (validated.volume !== -1) {
        await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
          '/MediaRenderer/RenderingControl/Control', 'SetVolume',
          { InstanceID: 0, Channel: 'Master', DesiredVolume: validated.volume })
      }  
    } else {
      throw new Error(`${NRCSP_ERRORPREFIX} Sonos player is not TV enabled`)
    }
    
    return {}
  }

  /**  Set bass.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string/number}  msg[stateName] -10 to +10 integer.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetBass (node, msg, stateName, cmdName, sonosPlayer) {
    // payload volume is required.
    const newBass = string2ValidInteger(msg, stateName, -10, +10, 'set bass', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl

    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'SetBass',
      { InstanceID: 0, DesiredBass: newBass })

    return {}
  }

  /**  Set player EQ type
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg[cmdName] the lowercase, player.set.nightmode/subgain/dialoglevel
   * @param  {string}  msg[stateName] value on,off or -15 .. 15 in case of subgain
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName default: cmd - in compatibility mode: payload
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetEQ (node, msg, stateName, cmdName, sonosPlayer) {
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    sonosSinglePlayer.baseUrl = groupData.members[groupData.playerIndex].baseUrl

    // verify that player has a TV mode
    const properties = await sonosSinglePlayer.deviceDescription()
    if (!isValidPropertyNotEmptyString(properties, ['modelName'])) {
      throw new Error(`${NRCSP_ERRORPREFIX} Sonos player model name undefined`)
    }
    if (!PLAYER_WITH_TV.includes(properties.modelName)) {
      throw new Error(`${NRCSP_ERRORPREFIX} Selected player does not support TV`)
    }

    let eqType
    let eqValue
    // no check exist needed as command has already been checked
    if (msg[cmdName] === 'player.set.nightmode') {
      eqType = 'NightMode'
      eqValue = isOnOff(msg, stateName, 'nightmode', NRCSP_ERRORPREFIX) // required
      eqValue = (eqValue ? 1 : 0)
    } else if (msg[cmdName] === 'player.set.subgain') {
      eqType = 'SubGain'
      eqValue = string2ValidInteger(msg, stateName, -15, 15, 'subgain', NRCSP_ERRORPREFIX) // required
    } else if (msg[cmdName] === 'player.set.dialoglevel') {
      eqType = 'DialogLevel'
      eqValue = isOnOff(msg, stateName, 'dialoglevel', NRCSP_ERRORPREFIX) // required
      eqValue = (eqValue ? 1 : 0)
    } else {
      // can not happen
    }

    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'SetEQ',
      { InstanceID: 0, EQType: eqType, DesiredValue: eqValue })
    
    return {}
  }

  /**  Set player led on/off.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] on/off
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetLed (node, msg, stateName, cmdName, sonosPlayer) {
    // msg.state is required
    let newState = isOnOff(msg, stateName, 'led state', NRCSP_ERRORPREFIX)
    newState = newState ? 'On' : 'Off'

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const sonosSinglePlayer = new Sonos(groupData.members[groupData.playerIndex].urlHostname)
    // baseUrl not needed

    await sonosSinglePlayer.setLEDState(newState)
    return {}
  }

  /**  Set player loudness on/off.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] on/off
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetLoudness (node, msg, stateName, cmdName, sonosPlayer) {
    // msg.state is required
    let newState = isOnOff(msg, stateName, 'loudness state', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'SetLoudness',
      { InstanceID: 0, Channel: 'Master', DesiredLoudness: newState })
    
    return {}
  }

  /**  Set mute for given player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] on/off.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetMute (node, msg, stateName, cmdName, sonosPlayer) {
    // payload mute state is required.
    const newState = isOnOff(msg, stateName, 'mute state', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)

    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'SetMute',
      { InstanceID: 0, Channel: 'Master', DesiredMute: newState })

    return {}
  }

  /**  Player set treble.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string/number}  msg[stateName] -10 to +10 integer.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetTreble (node, msg, stateName, cmdName, sonosPlayer) {
    // payload volume is required.
    const newTreble = string2ValidInteger(msg, stateName, -10, +10, 'set treble', NRCSP_ERRORPREFIX)

    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    
    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'SetTreble',
      { InstanceID: 0, DesiredTreble: newTreble })

    return {}
  }

  /**  Set volume for given player.
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {number/string} msg[stateName] volume, integer 0 .. 100 integer.
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerSetVolume (node, msg, stateName, cmdName, sonosPlayer) {
    // payload volume is required.
    const validatedVolume = string2ValidInteger(msg, stateName, 0, 100, 'volume', NRCSP_ERRORPREFIX)
    const validatedPlayerName = stringValidRegex(msg, 'playerName', REGEX_ANYCHAR, 'player name', NRCSP_ERRORPREFIX, '')
    const groupData = await getGroupMemberDataV2(sonosPlayer, validatedPlayerName)
    
    // no check - always returns true
    await executeActionV6(groupData.members[groupData.playerIndex].baseUrl,
      '/MediaRenderer/RenderingControl/Control', 'SetVolume',
      { InstanceID: 0, Channel: 'Master', DesiredVolume: validatedVolume })

    return {}
  }

  /**  Test action V5
   * @param  {object}  node not used
   * @param  {object}  msg incoming message
   * @param  {string}  msg.[stateName] modified arguments, endpoint, action
   * @param  {string}  [msg.playerName] SONOS player name - if missing uses sonosPlayer
   * @param  {string}  stateName default: payload - in compatibility mode: topic
   * @param  {string}  cmdName not used
   * @param  {object}  sonosPlayer Sonos player - as default and anchor player
   *
   * @return {promise} {}
   *
   * @throws any functions throws error and explicit throws
   */
  async function playerExecuteActionV6 (node, msg, stateName, cmdName, sonosPlayer) {
    
    const validated = await validatedGroupProperties(msg, NRCSP_ERRORPREFIX)
    const groupData = await getGroupMemberDataV2(sonosPlayer, validated.playerName)
    const { endpoint, action, inArgs } = msg.payload
    const result = await executeActionV6(groupData.members[groupData.playerIndex].baseUrl, endpoint, action, inArgs)
    return { payload: result }
  }

  // ========================================================================
  //
  //             HELPER
  //
  // ========================================================================

  /**  Validates group properties msg.playerName, msg.volume, msg.sameVolume, msg.clearQueue
   * @param  {object}        msg incoming message
   * @param  {string}        [msg.playerName = ''] playerName
   * @param  {string/number} [msg.volume = -1] volume. if not set don't touch original volume.
   * @param  {boolean}       [msg.sameVolume = true] sameVolume
   * @param  {boolean}       [msg.clearQueue = true] indicator for clear queue
   * @param  {string}        pkgPrefix package identifier
   *
   * @return {promise} object {playerName, volume, sameVolume, flushQueue}
   * playerName is '' if missing.
   * volume is -1 if missing. Otherwise number, integer in range 0 ... 100
   * sameVolume is true if missing.
   * clearQueue is true if missing.
   *
   * @throws error for all invalid values
   */
  async function validatedGroupProperties (msg, pkgPrefix) {
    // if missing set to ''.
    const newPlayerName = stringValidRegex(msg, 'playerName', REGEX_ANYCHAR, 'player name', NRCSP_ERRORPREFIX, '')

    // if missing set to -1.
    const newVolume = string2ValidInteger(msg, 'volume', 0, 100, 'volume', NRCSP_ERRORPREFIX, -1)

    // if missing set to true - throws errors if invalid
    let newSameVolume = true
    if (isValidProperty(msg, ['sameVolume'])) {
      if (typeof msg.sameVolume !== 'boolean') {
        throw new Error(`${pkgPrefix}: sameVolume (msg.sameVolume) is not boolean`)
      }
      if (newVolume === -1 && msg.sameVolume === true) {
        throw new Error(`${pkgPrefix}: sameVolume (msg.sameVolume) is true but msg.volume is not specified`)
      }
      newSameVolume = msg.sameVolume
    }

    // if missing set to true - throws errors if invalid
    let clearQueue = true
    if (isValidProperty(msg, ['clearQueue'])) {
      if (typeof msg.flushQueue !== 'boolean') {
        throw new Error(`${pkgPrefix}: clearQueue (msg.cleanQueue) is not boolean`)
      }
      clearQueue = msg.clearQueue
    }

    return { playerName: newPlayerName, volume: newVolume, sameVolume: newSameVolume, clearQueue: clearQueue }
  }

  RED.nodes.registerType('sonos-universal', SonosUniversalNode)
}
