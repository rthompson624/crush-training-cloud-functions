"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
// Set your secret key: remember to change this to your live secret key in production
// See your keys here: https://dashboard.stripe.com/account/apikeys
// const stripe = require("stripe")("sk_test_sdu5DtlWcT96u8IqTjq3PIlo");
const stripe = require("stripe")("sk_live_9FvtzRM5SmGKyNeWey1AZkWI");
// Start writing Firebase Functions
// https://firebase.google.com/docs/functions/typescript
exports.processSubscription = functions.firestore.document('subscription/{subscriptionID}').onCreate((doc) => {
    const subscriptionID = doc.id;
    const plan = doc.get('plan');
    const token = doc.get('token');
    const userID = doc.get('userID');
    const stripeCustomerID = doc.get('stripeCustomerID');
    const stripePlanID = doc.get('stripePlanID');
    return stripe.subscriptions.create({
        customer: stripeCustomerID,
        source: token,
        items: [
            {
                plan: stripePlanID
            },
        ]
    })
        .then(subscription => {
        // Update subscription record
        return admin.firestore().doc('subscription/' + subscriptionID).update({
            stripeSubscriptionID: subscription.id
        })
            .then(res => {
            // Update user record
            return admin.firestore().doc('user/' + userID).update({
                plan: plan,
                planExpiration: addDays(35, new Date()),
                status: 'active'
            });
        });
    })
        .catch(err => {
        console.log('Subscription ' + subscriptionID + ' for user ' + userID + ' resulted in Stripe error type ' + err.type);
        console.log(err.message);
        // Update subscription record with error
        return admin.firestore().doc('subscription/' + subscriptionID).update({
            subscriptionError: err.message
        });
    });
});
exports.updateSubscription = functions.firestore.document('subscription/{subscriptionID}').onUpdate((change) => {
    const stripeSubscriptionID = change.after.get('stripeSubscriptionID');
    const stripePlanID = change.after.get('stripePlanID');
    const cancelled = change.after.get('cancelled');
    if (cancelled) {
        return stripe.subscriptions.del(stripeSubscriptionID)
            .then(subscription => {
            if (subscription.status !== 'canceled') {
                console.log('Stripe did not provide proper confirmation that subscription ' + stripeSubscriptionID + ' was cancelled in their system. You may want to follow up on it.');
            }
            return;
        })
            .catch(err => {
            console.log('Attempt to cancel subscription ' + stripeSubscriptionID + ' resulted in Stripe error type ' + err.type);
            console.log(err.message);
            return;
        });
    }
    else {
        return stripe.subscriptions.retrieve(stripeSubscriptionID)
            .then(subscription => {
            return stripe.subscriptions.update(stripeSubscriptionID, {
                items: [{
                        id: subscription.items.data[0].id,
                        plan: stripePlanID
                    }]
            });
        })
            .catch(err => {
            console.log('Attempt to update subscription ' + stripeSubscriptionID + ' to plan ' + stripePlanID + ' resulted in Stripe error type ' + err.type);
            console.log(err.message);
            return;
        });
    }
});
exports.recurringSubscriptionPayment = functions.https.onRequest((req, res) => {
    const eventType = req.body.type;
    const invoice = req.body.data.object;
    console.log('Processing invoice ' + invoice.id + ' for customer ' + invoice.customer);
    if (!eventType)
        throw new Error('No event type designation in request.');
    if (!invoice)
        throw new Error('No invoice data in request.');
    if (eventType === 'invoice.payment_succeeded') {
        // Lookup user record
        return admin.firestore().collection('user').where('stripeCustomerID', "==", invoice.customer).get()
            .then(snapShot => {
            const userID = snapShot.docs[0].id;
            // Update user record to reflect payment
            return admin.firestore().doc('user/' + userID).update({
                planExpiration: addDays(35, new Date())
            });
        })
            .then(() => res.status(200).send('Successfully handled ' + eventType + ' for invoice ' + invoice.id))
            .catch(err => res.status(400).send('Error handling ' + eventType + ' for invoice ' + invoice.id));
    }
    else {
        console.log('Invoice payment failed for customer ' + invoice.customer + '. Event type ' + eventType);
        return res.status(200).send('Successfully handled ' + eventType + ' for invoice ' + invoice.id);
    }
});
exports.createStripeCustomer = functions.firestore.document('user/{userID}').onCreate((doc) => {
    const userID = doc.id;
    const email = doc.get('email');
    const type = doc.get('type');
    // Only create customer account for trainers
    if (type !== 'trainer')
        return 'not a trainer';
    return stripe.customers.create({
        email: email
    })
        .then(customer => {
        // Update user record
        return admin.firestore().doc('user/' + userID).update({
            stripeCustomerID: customer.id
        });
    })
        .catch(err => {
        console.log('Attempting to create a Stripe customer for user ' + userID + ' resulted in error type ' + err.type);
        console.log(err.message);
        return;
    });
});
exports.processPayment = functions.firestore.document('payment/{paymentID}').onCreate((doc) => {
    const paymentID = doc.id;
    const plan = doc.get('plan');
    const price = doc.get('price');
    const token = doc.get('token');
    const userID = doc.get('userID');
    return stripe.charges.create({
        amount: price,
        currency: 'usd',
        description: plan,
        source: token
    })
        .then(charge => {
        // Update payment record with charge
        return admin.firestore().doc('payment/' + paymentID).update({
            chargeID: charge.id
        })
            .then(res => {
            // Update user record
            return admin.firestore().doc('user/' + userID).update({
                plan: plan,
                planExpiration: addDays(35, new Date()),
                status: 'active'
            });
        });
    })
        .catch(err => {
        console.log('Payment ' + paymentID + ' for user ' + userID + ' resulted in Stripe error type ' + err.type);
        console.log(err.message);
        // Update payment record with charge error
        return admin.firestore().doc('payment/' + paymentID).update({
            chargeError: err.message
        });
    });
});
function addDays(days, date) {
    const dateCopy = new Date(date);
    dateCopy.setDate(dateCopy.getDate() + days);
    return dateCopy;
}
//# sourceMappingURL=index.js.map