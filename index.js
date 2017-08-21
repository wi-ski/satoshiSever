const express = require("express");
const bodyParser = require('body-parser');
const storage = require("./libs/storage");
const serve = require("./libs/serve");
const Flash = require("iota.flash.js");
const multisig = Flash.multisig;
const channel = require("./libs/channel");
const cors = require('cors')
const crypto = require('crypto');

const SEED = 'DDVZVZ9QJPUGMDAKGPTEUBOS9AWWVWF99MCKNIXALMKJRBGSQMXOVBRKHSJNOVMBZJRRRMVNXJCKPXPXJ';

const app = express();

app.use(cors())
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/register', (req, res, next) => { 
  storage.get('channel_' + req.body.id, (err, state) => {
    if (state) {
      res.json({'error': 'Channel already exists'});
      return;
    }
    channel.getSubseed(SEED, (err, seed) => {
      if (err) {
        res.send(500).json({'error': 'Internal server error'});
        return;
      }
      const digests = req.body.digests;
      flash = new Flash({
        'index': 0,
        'security': 2,
        'deposit': [0, 0, 0],
        'stakes': [1, 0, 0],
      });
      let myDigests = digests.map(() => multisig.getDigest(seed, flash.state.index++, flash.state.security));
      { // compose multisigs, write to remainderAddress and root
        let multisigs = digests.map((digest, i) => {
          let addy = multisig.composeAddress([digest, myDigests[i]])    
          addy.index = myDigests[i].index
          addy.security = myDigests[i].security 
          return addy    
        });
        flash.state.remainderAddress = multisigs.shift();
        for(let i = 1; i < multisigs.length; i++) {
          multisigs[i-1].children.push(multisigs[i]);
        }
        flash.state.root = multisigs.shift();
      }
      storage.set('channel_' + req.body.id, {
        'seed': seed, 
        'flash': flash
      }, (err) =>{
        if (err) {
          res.send(500).end();
          return;
        }
        //
        // TODO: respond to client and establish channel        
        //
        res.json({
          digests: myDigests
        });
      });
    });
  });
});

app.post('/address', (req, res, next) => {
  const clientDigest = req.body.digest;
  const digest = channel.getNewDigest(req.body.id, (err, digest) => {
    if (err) {
      res.status(404).json({'error': 'Unknown channel'});
      return;
    }
    res.json({
      'address': channel.getAddress([clientDigest, digest])
    });
  });
});

app.post('/purchase', (req, res, next) => {
  const bundles = req.body.bundles;
  const item = storage.get('item_' + req.body.item, (err, item) => {
    if (item) {
      channel.processTransfer(req.body.id, item, bundles, (err, valid) => {
        if (err) {
          res.status(404).json({'error': 'Unknown channel'});
          return;
        }
        if(!valid) {
         res.status(403).json({'error': 'Invalid transfer'}); 
          return;
        }
        const key = crypto.randomBytes(256).toString('hex');
        storage.set(item.id + '_' + key, 1, (err) => {
          if (err) {
            res.status(500).json({'error': 'Internal server error'});
            return;
          }
          res.json({'id': item.id,'key': key});
        });
      });
    }
    else {
      res.status(404).json({'error': 'Item not found'});
    }
  });
});

app.post('/item', (req, res) => {
 /* if (req.get('Authorization') !== '') {
    res.status(403).end();
    return;
  }*/
  const item = {
    'id': req.body.id,
    'value': req.body.value
  }
  storage.set('item_' + item.id, item, (err) => {
    if (err) {
      res.status(500).end();
      return;
    }
    res.json(item);
  });
})

app.get('/item/:item/:key', (req, res, next) => {
  storage.get(req.params.item + '_' + req.params.key, (err, exists) => {
    if (err) {
      res.status(500).json({'error': 'Internal server error'});
      return;
    }
    if (exists !== 1) {
      res.status(403).json({'error': 'Unauthorized'});
      return;
    }
    next();
  });
})



app.use(serve);

app.listen(9000, function() {
  console.log("Listening on port 9000!")
})
