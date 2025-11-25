const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2ic5wod.mongodb.net/?appName=Cluster0`;
const stripe = require("stripe")(process.env.STRIP_KEY);
const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("zap_shift_db");
    const parcelsColl = db.collection("parcels");
    const paymentColl = db.collection("payment");

    // parcels related apis
    app.post("/parcels", async (req, res) => {
      const parcelsDoc = req.body;
      parcelsDoc.requestedAt = new Date();
      const result = await parcelsColl.insertOne(parcelsDoc);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const parcels = req.body;
      const email = req.query.email;
      const query = {};
      if (email) {
        query.senderEmail = email;
      }
      const options = { requestedAt: -1 };
      const result = await parcelsColl.find(query).sort(options).toArray();
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsColl.findOne(query);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsColl.deleteOne(query);
      res.send(result);
    });

    // payment apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseFloat(paymentInfo?.courierCost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: { name: paymentInfo.parcelName },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: paymentInfo.senderEmail,
        metadata: {
          parcelId: paymentInfo.parcelID,
          name: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/paymentCancel`,
      });

      res.send(session.url);
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionID = req.query.session_id;
      const sessionRetrieve = await stripe.checkout.sessions.retrieve(
        sessionID
      );

      const trackingID = generateTrackingId();
      console.log(sessionRetrieve);
      const query = { transactionID: sessionRetrieve.payment_intent };
      const isExistingPayment = await paymentColl.findOne(query);
      console.log(isExistingPayment);
      if (isExistingPayment) {
        return res.send({
          message: "Already paid for it.",
          trackingID,
          transactionID: sessionRetrieve.payment_intent,
        });
      }

      if (sessionRetrieve.payment_status === "paid") {
        const id = sessionRetrieve.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = { $set: { paymentStatus: "paid", trackingID } };
        const result = await parcelsColl.updateOne(query, update);

        const paymentHistory = {
          paymentAmount: sessionRetrieve.amount_total / 100,
          customerEmail: sessionRetrieve.customer_email,
          currency: sessionRetrieve.currency,
          parcelID: sessionRetrieve.metadata.parcelId,
          parcelName: sessionRetrieve.metadata.name,
          transactionID: sessionRetrieve.payment_intent,
          paymentStatus: sessionRetrieve.payment_status,
          paidAt: new Date(),
          trackingID: trackingID,
        };

        const resultPayment = await paymentColl.insertOne(paymentHistory);

        console.log("full operation is complete");
        return res.send({
          success: true,
          trackingID,
          transactionID: sessionRetrieve.payment_intent,
          modifyParcel: result,
          paymentInfo: resultPayment,
        });
      }

      res.send({ success: false });
    });

    app.get('/payments', async(req,res)=>{
      const result = await paymentColl.find().toArray()
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Zap Shift is Shifting...😉");
});

app.listen(port, () => {
  console.log(`Zap shift is listening on port ${port}`);
});
