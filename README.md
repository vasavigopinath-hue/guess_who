# Guess Who

A simple Guess Who board you fill with your own photos.

- **Add photos:** click any blank slot to pick a photo for it, or open the ☰ menu and use **+ Add photos** to fill the blank slots in order. You can also drag images onto the page.
- **Knock out:** click a picture to fade it under a grey haze. Click it again to bring it back.
- The bottom of the page shows how many are left, like **22 of 24 remaining**. Blurring a slot knocks it out.
- Click **Add slot** at the end of the board to add a slot. Hover any slot and click × to delete it.
- The ☰ menu lets you switch between boards or **Add new board**. Each board keeps its own photos. For the board you're on, it also has **Add photos**, **Reset Board** (unblur everyone), **Background Color**, **Rename Board** and **Delete Board**.
- The board shows 12 slots per row (6 per row on phones) and starts with 24 blank slots.
- Boards and photos are saved in your browser, so they're still there after a refresh.
- Click **Save** (top right) to put your boards and photos on the website, so they show up on any device that opens it. Knock-outs aren't saved, so every device plays its own round.
- After saving, the board is **locked**: you can still knock people out and switch boards, but adding, deleting, renaming and colours are hidden until you press **Edit**.

It's a plain static site (HTML, CSS and JS) with no build step, plus two small Vercel functions in `api/` that save and load boards using [Vercel Blob](https://vercel.com/docs/vercel-blob).

## Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this repo.
2. Leave the framework preset as **Other** and click **Deploy**.
3. To turn on **Save**: in the project, open **Storage → Create → Blob**, connect it to this project, then redeploy. That adds `BLOB_READ_WRITE_TOKEN` (or `BLOB_STORE_ID`) for you.
4. Optional: add an environment variable `SAVE_PASSWORD` so only people who know it can save. Anyone can still view the boards.

## Run locally

Open `index.html` in a browser, or run `npx serve .` in this folder.
