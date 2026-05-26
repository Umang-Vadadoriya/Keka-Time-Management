Hey Team 👋

A tiny bookmarklet that overlays *Work Duration*, *Break Time*, and the *exact second you can clock out to hit 8h* inside Keka's attendance modal. No extension needed.

📌 *Bookmarklet*
```javascript:(()=>{fetch("https://gist.githubusercontent.com/Umang-Vadadoriya/ffc09708226db8bef988a0ecf1848518/raw/KekaEnhance.js").then(r=>r.text()).then(eval);})();```

🛠️ *Setup (once)*
Right-click bookmarks bar → *Add page…* → Name `Keka Script`, URL the command above → Save.

▶️ *Use*
Click the bookmark on the Keka attendance page → open any day's *Regularize* modal. Refresh = click bookmark again. Updates ship automatically.
