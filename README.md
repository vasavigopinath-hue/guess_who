# Guess Who

A simple Guess Who board you fill with your own photos.

- **Add photos:** click any blank slot to pick a photo for it, or open the ☰ menu and use **+ Add photos** to fill the blank slots in order. You can also drag images onto the page.
- **Blur:** click a picture to blur it out. Click it again to bring it back.
- The bottom of the page shows how many are left, like **22 of 24 remaining**. Blurring a slot knocks it out.
- Click **Add slot** at the end of the board to add a slot. Hover any slot and click × to delete it.
- The ☰ menu also has **Unblur all** to start a new round and **Remove all photos**.
- The board shows 12 slots per row (6 per row on phones) and starts with 24 blank slots.
- Photos are saved in your browser, so they're still there after a refresh. They are not uploaded anywhere.

It's a plain static site (HTML, CSS and JS) with no build step.

## Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this repo.
2. Leave the framework preset as **Other** and click **Deploy**.

## Run locally

Open `index.html` in a browser, or run `npx serve .` in this folder.
