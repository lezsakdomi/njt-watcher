import * as functions from 'firebase-functions'
import Axios from 'axios'
import * as admin from 'firebase-admin'

const {
    messenger_platform_apis: {
        page_access_token: accessToken,
        webhook_verify_token: verifyToken,
    },
} = functions.config()

async function postMessage(data: unknown) {
    await Axios.post(`https://graph.facebook.com/v2.6/me/messages?access_token=${accessToken}`, data)
}

// noinspection JSUnusedGlobalSymbols
export const webhook = functions.https.onRequest(async (req, res) => {
    console.log({
        query: JSON.stringify(req.query),
        body: JSON.stringify(req.body),
    })

    try {
        // Parse the query params
        const mode = req.query['hub.mode']
        const token = req.query['hub.verify_token']
        const challenge = req.query['hub.challenge']

        // Checks if a token and mode is in the query string of the request
        if (mode && token) {

            // Checks the mode and token sent is correct
            if (mode === 'subscribe' && token === verifyToken) {

                // Responds with the challenge token from the request
                console.log('WEBHOOK_VERIFIED')
                res.status(200).send(challenge)
                return
            } else {
                // Responds with '403 Forbidden' if verify tokens do not match
                res.sendStatus(403)
                return
            }
        }

        // Parse the request body from the POST
        // todo https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages
        const body: {
            object: 'page' | any;
            entry: {
                messaging: [{
                    sender: {
                        id: string;
                    };
                    message?: {
                        text?: string;
                        attachments?: {
                            payload: {
                                url: string;
                            };
                        }[];
                    };
                    postback?: {
                        payload: string;
                    };
                }];
            }[];
        } = req.body

        // Check the webhook event is from a Page subscription
        if (body.object === 'page') {

            for (const entry of body.entry) {
                // Get the webhook event. entry.messaging is an array, but
                // will only ever contain one event, so we get index 0
                const event = entry.messaging[0]
                console.log(JSON.stringify(event))

                async function respond(message: unknown) {
                    await postMessage({
                        recipient: {
                            id: event.sender.id,
                        },
                        message,
                    })
                }

                if (event.postback) {
                    const {postback} = event
                    if (postback?.payload.match(/^subscribe:[a-zA-Z\u00C0-\u024F]+$/)) {
                        const [, watch] = postback?.payload.match(/:(.*)/) as [string, string]
                        await admin.firestore()
                            .collection('watches').doc(watch).collection('messengerSubscribers').doc(event.sender.id)
                            .set({
                                psid: event.sender.id,
                                sender: event.sender,
                                subscriptionEvent: event,
                            })
                        await respond({
                            text: `Ok, we'll notify you about ${watch}.`,
                        })
                    } else if (postback?.payload.match(/^unsubscribe:[a-zA-Z\u00C0-\u024F]+$/)) {
                        const [, watch] = postback?.payload.match(/:(.*)/) as [string, string]
                        await admin.firestore()
                            .collection('watches').doc(watch).collection('messengerSubscribers').doc(event.sender.id)
                            .delete()
                        await respond({
                            text: `Subscription for ${watch} deleted.`,
                        })
                    } else {
                        await respond({
                            text: "It seems like your response was invalid.",
                        })
                    }
                } else {
                    const querySnapshot = await admin.firestore().collection('watches').get()
                    await respond({
                        text: "Hi! I am a chatbot. Please select a few feeds below to subscribe to.",
                    })
                    await respond({
                        attachment: {
                            type: 'template',
                            payload: {
                                template_type: 'generic',
                                elements: querySnapshot.docs.map(docSnapshot => {
                                    return {
                                        title: docSnapshot.data().title,
                                        subtitle: docSnapshot.data().subtitle,
                                        buttons: [
                                            {
                                                title: "Subscribe",
                                                type: 'postback',
                                                payload: `subscribe:${docSnapshot.id}`,
                                            },
                                            {
                                                title: "Unsubscribe",
                                                type: 'postback',
                                                payload: `unsubscribe:${docSnapshot.id}`,
                                            },
                                        ],
                                    }
                                }),
                            },
                        },
                    })
                }
            }

            // Return a '200 OK' response to all events
            res.status(200).send('EVENT_RECEIVED')
            return
        } else {
            // Return a '404 Not Found' if event is not from a page subscription
            res.sendStatus(404)
            return
        }
    } catch (e) {
        console.error(e)
        res.sendStatus(500)
        return
    }
})

// noinspection JSUnusedGlobalSymbols
export const onCreate = functions.firestore
    .document('watches/{keyword}/results/{id}')
    .onCreate(async (snapshot, {params: {keyword}}) => {
        const data = snapshot.data()
        if (!data) return

        const subscribersSnapshot = await admin.firestore().collection('watches').doc(keyword).collection('messengerSubscribers').get()
        for (const subscriberSnapshot of subscribersSnapshot.docs) {
            await postMessage({
                recipient: {
                    id: subscriberSnapshot.data().psid,
                },
                message: {
                    attachment: {
                        type: 'template',
                        payload: {
                            template_type: 'generic',
                            elements: [
                                {
                                    title: `[${keyword}] ${data.title}`,
                                    subtitle: `${data.description}`,
                                    default_action: {
                                        type: 'web_url',
                                        url: `http://njt.hu/cgi_bin/njt_doc.cgi?docid=${data.id}.${data.subId}`,
                                    },
                                },
                            ],
                        },
                    },
                },
            })
        }
    })
