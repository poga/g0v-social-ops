const {RtmClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client')
const toilet = require('toiletdb')
const path = require('path')
const request = require('superagent')
const schedule = require('node-schedule')

var db = toilet(path.join(process.cwd(), 'data.json'))

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const MASTODON_TOKEN = process.env.MASTODON_TOKEN
const HOST = process.env.MASTODON_HOST

var rtm

if (!BOT_TOKEN) throw new Error('slack token required')
if (!MASTODON_TOKEN) throw new Error('mastodon token required')
if (!HOST) throw new Error('mastodon host required')

db.open(function (err) {
  if (err) throw err

  run()

  startTimer(db)
})

function startTimer (db) {
  return schedule.scheduleJob('* */4 * * *', function () {
    console.log('looking for scheduled post')
    db.read('posts', function (err, data) {
      if (err) return console.error(err)
      if (!data) return

      data.forEach(post => {
        if (isReadyForPublish(post)) {
          publish(db, post.id, function (err, published) {
            if (err) return console.error(err)
            console.log('schedule published:', published)
          })
        }
      })
    })
  })
}

function run () {
  rtm = new RtmClient(BOT_TOKEN)

  rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, function (data) {
    console.log(`logged in as ${data.self.name}`)
  })

  rtm.on(RTM_EVENTS.MESSAGE, function (message) {
    console.log('event', message)
    if (message.type === 'message' && !message.subtype) {
      handler(message)
    }
  })

  rtm.start()
}

function handler (message) {
  var cmd = parse(message.text)
  if (!cmd) return
  console.log(cmd)
  switch (cmd.command) {
    case 'post-new':
      newPost(db, cmd.url, function (err, post) {
        if (err) replyError(message.channel, err)

        replyStatus(message.channel, `post added ${JSON.stringify(post)}`)
      })
      break
    case 'post-update':
      updatePost(db, cmd.id, cmd.text, function (err, newPost) {
        if (err) replyError(message.channel, err)

        replyStatus(message.channel, `post updated ${JSON.stringify(newPost)}`)
      })
      break
    case 'post-publish':
      publish(db, cmd.id, function (err, published) {
        if (err) replyError(message.channel, err)

        replyStatus(message.channel, `post published ${JSON.stringify(published)}`)
      })
      break
  }
}

function parse (text) {
  if (!text.startsWith('post')) return

  var argv = text.split(' ')

  if (argv[1] === 'new') {
    return {
      command: 'post-new',
      url: argv[2].slice(1, -1)
    }
  }

  if (argv[1] === 'update') {
    return {
      command: 'post-update',
      id: argv[2],
      text: argv.slice(3).join(' ').replace(/<(.+)\|(.+)>/, function (match, link) {
        return link
      })
    }
  }

  if (argv[1] === 'publish') {
    return {
      command: 'post-publish',
      id: argv[2]
    }
  }
}

function newPost (db, url, cb) {
  db.read('posts', function (err, data) {
    if (err) return cb(err)
    var post = {url: url, id: Math.floor(Date.now() / 1000)}
    if (!data) data = []
    data.push(post)

    db.write('posts', data, function (err) {
      if (err) return cb(err)

      cb(null, post)
    })
  })
}

function updatePost (db, id, text, cb) {
  db.read('posts', function (err, data) {
    if (err) return cb(err)
    var postIndex = data.findIndex(x => x.id === +id)
    var newPost = Object.assign({}, data[postIndex], {text: text})
    data[postIndex] = newPost

    db.write('posts', data, function (err) {
      if (err) return cb(err)

      cb(null, newPost)
    })
  })
}

function publish (db, id, cb) {
  db.read('posts', function (err, data) {
    if (err) return cb(err)
    var toPublish = data.find(x => x.id === +id)
    if (!toPublish) return cb(new Error(`can't find post with id ${id}`))
    if (!isReadyForPublish(toPublish)) return cb(new Error(`Post is not ready for publishing`))

    _publish(db, toPublish)
  })

  function _publish (db, post) {
    request
      .post(`${HOST}/api/v1/statuses`)
      .query({access_token: MASTODON_TOKEN})
      .type('form')
      .send({status: [post.text, post.url].join('\n\n')})
      .end(function (err, res) {
        if (err) return cb(err)
        archive(post)
      })
  }

  function archive (post) {
    db.read('posts', function (err, data) {
      if (err) return cb(err)
      var postIndex = data.findIndex(x => x.id === post.id)
      db.read('archived', function (err, archived) {
        if (err) return cb(err)
        if (!archived) archived = []
        var toArchive = data[postIndex]
        archived.push(toArchive)
        data.splice(postIndex, 1)

        db.write('archived', archived, function (err) {
          if (err) return cb(err)

          db.write('posts', data, function (err) {
            if (err) return cb(err)

            cb(null, toArchive)
          })
        })
      })
    })
  }
}

function replyStatus (channel, msg) {
  rtm.sendMessage(`[STATUS] ${msg}`, channel)
}

function replyError (channel, err) {
  rtm.sendMessage(`[ERROR] ${err.message}`, channel)
}

function isReadyForPublish (post) {
  return !!post.text
}
