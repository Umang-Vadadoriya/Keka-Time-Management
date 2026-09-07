Hey Team 👋

Ever do the mental math in Keka trying to figure out *when* you've actually hit your 8 hours? This little helper does it for you — right inside Keka.

Once it's on, open any day and you'll instantly see:
• ⏱️  Your total work time (down to the second)
• ☕  Your total break time
• 🎯  The *exact* time you can clock out to complete 8 hours

📽️ *See it in action:* [▶️ 10-second demo](ADD_GIF_LINK_HERE)

✅ *One-time setup — takes about 30 seconds*
1. Make sure your bookmarks bar is showing (press `Ctrl`+`Shift`+`B`).
2. Right-click the bookmarks bar → *Add page…* (or *Add bookmark*).
3. *Name* it: `Keka Helper`
4. In the *URL* box, paste this in *exactly*:
```
javascript:(()=>{fetch("https://gist.githubusercontent.com/Umang-Vadadoriya/ffc09708226db8bef988a0ecf1848518/raw/KekaEnhance.js").then(r=>r.text()).then(eval);})();
```
5. Click *Save*. That's it — you never have to set this up again.

▶️ *How to use it (every day)*
Open Keka, then click the *Keka Helper* bookmark once. You'll see a small "✅ Keka helper active" pop up — that means it's working. Now open any day and the numbers appear automatically.

👉 It stays on while you click around Keka. The only time you'd click the bookmark again is if you do a full page refresh.

🔒 *Is it safe?*
Yes. The code lives on our internal GitHub, it only *reads* your own Keka data, it only talks to Keka, and nothing ever leaves your browser. No app or browser extension to install.

Got a question or an idea to make it better? Just ping me 🙌
