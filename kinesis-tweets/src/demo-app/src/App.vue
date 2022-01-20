<template>
  <v-app>
    <v-main>
      <v-container fill-height fluid >
        <v-carousel v-model="position" hide-delimiters :interval="2000" :cycle="true" :show-arrows="false">
          <v-carousel-item v-for="(tweet, index) in tweets" :key="index">
            <v-card class="mx-auto" max-width="455" color="primary" dark outlined>
              <v-list-item three-line>
                <v-list-item-content>
                  <div class="text-overline mb-4">Publish to display (Sec):
                    <b>+{{ tweet.timeTaken }}</b>
                  </div>
                  <div class="text-overline mb-4">Tweet published at:
                    <b>{{ tweet.createdAt }}</b>
                  </div>
                  <v-list-item-title class="text-h6 mb-1">
                    Tweet Message:
                  </v-list-item-title>
                  <v-list-item-subtitle>
                    {{ tweet.message }}
                    </v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </v-card>
          </v-carousel-item>
        </v-carousel>
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts">

interface Tweet {
  message: string;
  timeTaken: number;
  createdAt: string;
}

interface MqttMessage {
  created_at: string;
  received_at: number;
  id: string;
  text: string;
}

interface Data {
  tweets: Tweet[];
  position: number;
  messages: MqttMessage[];
}

import Vue from 'vue';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { Client, ConnectionOptions } from 'paho-mqtt';
import { Signer } from 'aws-amplify';



const POOL_ID = process.env.VUE_APP_POOL_ID || '';
const AWS_REGION = process.env.VUE_APP_AWS_REGION || '';
const CLIENT_ID = process.env.VUE_APP_CLIENT_ID || '';
const TOPIC = process.env.VUE_APP_TOPIC || '';
const MQTT_ENDPOINT = process.env.VUE_APP_MQTT_ENDPOINT || '';

export default Vue.extend({
  name: 'App',
  data(): Data {
    return {
      tweets: [],
      position: 0,
      messages: [],
    };
  },
  async created() {

    // fetch some temp creds from the cognito identity pool
    const awsCreds = await fromCognitoIdentityPool({ identityPoolId: POOL_ID, clientConfig: { region: AWS_REGION } })();

    // create a sigv4 signed websocket url. 
    const wssUrl = Signer.signUrl(
      `wss://${MQTT_ENDPOINT}/mqtt`,
      { access_key: awsCreds.accessKeyId, secret_key: awsCreds.secretAccessKey, session_token: awsCreds.sessionToken },
      { service: 'iotdevicegateway', region: AWS_REGION}
    );

    // connect to iot using presigned wss url.
    const mqttClient = new Client(wssUrl, CLIENT_ID);
    const onMqttConnection = () => {
      console.log('mqtt connected');
      mqttClient.subscribe(TOPIC);
    };
    const connectOptions: ConnectionOptions = {
      onSuccess: onMqttConnection,
      onFailure: (err) => console.error('mqtt connection failure', err),
      useSSL: true,
      timeout: 5,
      mqttVersion: 4
    }
    mqttClient.connect(connectOptions);

    // on receiving a message add the data message array.
    mqttClient.onMessageArrived = (message) => {
      try {
        const messagesJson = JSON.parse(message.payloadString) as MqttMessage[];
        this.messages = [...this.messages, ...messagesJson.map(message => ({ ...message, received_at: Date.now() }))];
      } catch (err) {
        console.error('failed to process new message', message.payloadString);
      }
    };

    // drip feed recently received messages into the tweet list for display.
    setInterval(() => {
      if (this.messages.length === 0) {
        return;
      }
      const newMessage = this.messages.pop() as MqttMessage;
      const tweet: Tweet = {
        message: newMessage.text,
        createdAt: newMessage.created_at,
        timeTaken: Math.floor((newMessage.received_at - new Date(newMessage.created_at).valueOf()) / 1000),
      };
      if (this.tweets.length < 10) {
        this.tweets.push(tweet);
      } else {
        this.tweets[this.position - 1] = tweet;
      }
    }, 2000);
  },
});
</script>
