const {RtmClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client')
const toilet = require('toiletdb')
var db = toilet('./data.json')

db.open(function (err) {
  if (err) throw err

  run()
})

var rtm

function run () {
  const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || ''

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
        if (err) console.log('write failed', err)

        rtm.sendMessage(`post added: ${JSON.stringify(post)}`, message.channel)
      })
      break
    case 'post-update':
      updatePost(db, cmd.id, cmd.text, function (err, newPost) {
        if (err) console.log('write failed', err)

        rtm.sendMessage(`post updated: ${JSON.stringify(newPost)}`, message.channel)
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
      text: argv[3]
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
    console.log(data)
    var postIndex = data.findIndex(x => x.id === +id)
    var newPost = Object.assign({}, data[postIndex], {text: text})
    console.log('new post', postIndex, newPost)
    data[postIndex] = newPost

    db.write('posts', data, function (err) {
      if (err) return cb(err)

      cb(null, newPost)
    })
  })
}
