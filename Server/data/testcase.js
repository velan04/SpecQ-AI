const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--headless', '--disable-gpu', '--remote-debugging-port=9222', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const url = 'https://api.example.com/';

  // Test Case 1: Verify Heading Content
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.waitForSelector('h3', { timeout: 2000 });
    const heading = await page.$eval('h3', el => el.textContent.trim());
    if (heading === 'Music Album Collection') {
      console.log('TESTCASE:verify_heading_content:success');
    } else {
      console.log('TESTCASE:verify_heading_content:failure');
    }
  } catch (e) {
    console.log('TESTCASE:verify_heading_content:failure');
  }

  // Test Case 2: Verify Input and Button Types
  const page1 = await browser.newPage();
  try {
    await page1.goto(url);
    await page1.waitForSelector('#albumName', { timeout: 2000 });
    await page1.waitForSelector('#releaseYear', { timeout: 2000 });
    await page1.waitForSelector('#genre', { timeout: 2000 });
    await page1.waitForSelector('#favorite', { timeout: 2000 });
    await page1.waitForSelector('#addAlbumBtn', { timeout: 2000 });
  
    const albumNameType = await page1.$eval('#albumName', el => el.getAttribute('type'));
    const releaseYearType = await page1.$eval('#releaseYear', el => el.getAttribute('type'));
    const genreTagName = await page1.$eval('#genre', el => el.tagName.toLowerCase());
    const favoriteType = await page1.$eval('#favorite', el => el.getAttribute('type'));
    const buttonType = await page1.$eval('#addAlbumBtn', el => el.getAttribute('type'));
  
    if (albumNameType === 'text' && releaseYearType === 'number' && genreTagName === 'select' && favoriteType === 'checkbox' && buttonType === 'button') {
      console.log('TESTCASE:verify_input_and_button_types:success');
    } else {
      console.log('TESTCASE:verify_input_and_button_types:failure');
    }
  } catch (e) {
    console.log('TESTCASE:verify_input_and_button_types:failure');
  }
  
  // Test Case 3: Verify Button Background Color
  const page2 = await browser.newPage();
  try {
    await page2.goto(url);
    await page2.waitForSelector('#addAlbumBtn', { timeout: 2000 });

    const buttonBackgroundColor = await page2.$eval('#addAlbumBtn', el => window.getComputedStyle(el).backgroundColor);
    if (buttonBackgroundColor === 'rgb(76, 175, 80)') {
      console.log('TESTCASE:verify_button_background_color:success');
    } else {
      console.log('TESTCASE:verify_button_background_color:failure');
    }
  } catch (e) {
    console.log('TESTCASE:verify_button_background_color:failure');
  }

  // Test Case 4: Verify Button Text
  const page3 = await browser.newPage();
  try {
    await page3.goto(url);
    await page3.waitForSelector('#addAlbumBtn', { timeout: 2000 });

    const buttonText = await page3.$eval('#addAlbumBtn', el => el.textContent.trim());

    if (buttonText === 'Add Album') {
      console.log('TESTCASE:verify_button_text:success');
    } else {
      console.log('TESTCASE:verify_button_text:failure');
    }
  } catch (e) {
    console.log('TESTCASE:verify_button_text:failure');
  }

  // Test Case 5: Verify Placeholder and Label Texts
// Test Case 5: Verify Placeholder and Label Texts
const page4 = await browser.newPage();
try {
  await page4.goto(url);
  await page4.waitForSelector('#albumName', { timeout: 2000 });
  await page4.waitForSelector('#releaseYear', { timeout: 2000 });
  await page4.waitForSelector('#genre', { timeout: 2000 });
  await page4.waitForSelector('#favorite', { timeout: 2000 });

  // Check placeholders
  const albumNamePlaceholder = await page4.$eval('#albumName', el => el.getAttribute('placeholder'));
  const releaseYearPlaceholder = await page4.$eval('#releaseYear', el => el.getAttribute('placeholder'));

  // Check labels
  const albumNameLabel = await page4.$eval('label[for="albumName"]', el => el.textContent.trim());
  const releaseYearLabel = await page4.$eval('label[for="releaseYear"]', el => el.textContent.trim());
  const genreLabel = await page4.$eval('label[for="genre"]', el => el.textContent.trim());
  const favoriteLabel = await page4.$eval('label[for="favorite"]', el => el.textContent.trim());

  if (
    albumNamePlaceholder === 'Enter album name' &&
    releaseYearPlaceholder === 'Enter release year' &&
    albumNameLabel.includes('Album Name') &&
    releaseYearLabel.includes('Release Year') &&
    genreLabel.includes('Genre') &&
    favoriteLabel.includes('Mark as Favorite')
  ) {
    console.log('TESTCASE:verify_placeholder_and_label_texts:success');
  } else {
    console.log('TESTCASE:verify_placeholder_and_label_texts:failure');
  }
} catch (e) {
  console.log('TESTCASE:verify_placeholder_and_label_texts:failure');
}


  // Test Case 7: Verify Page Title
  const page5 = await browser.newPage();
  try {
    await page5.goto(url);
    const pageTitle = await page5.title();

    if (pageTitle === 'Music Album Collection Manager') {
      console.log('TESTCASE:verify_page_title:success');
    } else {
      console.log('TESTCASE:verify_page_title:failure');
    }
  } catch (e) {
    console.log('TESTCASE:verify_page_title:failure');
  }


  const page6 = await browser.newPage();
try {
  await page6.goto(url);

  await page6.waitForSelector('#addAlbumBtn', { timeout: 2000 });
  await page6.waitForSelector('#error-message', { timeout: 2000 });
  await page6.waitForSelector('#albumList', { timeout: 2000 });
  await page6.waitForSelector('#favoriteAlbumList', { timeout: 2000 });

  const initialAlbumListContent = await page6.$eval('#albumList', el => el.textContent.trim());
  const initialFavoriteListContent = await page6.$eval('#favoriteAlbumList', el => el.textContent.trim());
  const initialErrorMessage = await page6.$eval('#error-message', el => el.textContent.trim());

  await page6.click('#addAlbumBtn');
  const errorMessage = await page6.$eval('#error-message', el => el.textContent.trim());

  if (
    initialAlbumListContent === '' &&
    initialFavoriteListContent === '' &&
    initialErrorMessage === '' &&
    errorMessage === 'Please fill out all fields!'
  ) {
    console.log('TESTCASE:verify_album_initial_state_and_validation:success');
  } else {
    console.log('TESTCASE:verify_album_initial_state_and_validation:failure');
  }

} catch (e) {
  console.log('TESTCASE:verify_album_initial_state_and_validation:failure');
}

const page7 = await browser.newPage();
try {
  await page7.goto(url);

  await page7.waitForSelector('#albumName', { timeout: 2000 });
  await page7.waitForSelector('#releaseYear', { timeout: 2000 });
  await page7.waitForSelector('#genre', { timeout: 2000 });
  await page7.waitForSelector('#favorite', { timeout: 2000 });
  await page7.waitForSelector('#addAlbumBtn', { timeout: 2000 });

  await page7.type('#albumName', 'Thriller');
  await page7.type('#releaseYear', '1982');
  await page7.select('#genre', 'Pop');
  await page7.click('#addAlbumBtn');

  await page7.waitForSelector('#albumList', { timeout: 2000 });

  const albumListContent = await page7.$eval('#albumList', el => el.textContent.trim());

  const albumNameAfterSubmit = await page7.$eval('#albumName', el => el.value.trim());
  const releaseYearAfterSubmit = await page7.$eval('#releaseYear', el => el.value.trim());
  const genreAfterSubmit = await page7.$eval('#genre', el => el.value.trim());
  const favoriteAfterSubmit = await page7.$eval('#favorite', el => el.checked);

  if (
    albumListContent.includes('Thriller') &&
    albumListContent.includes('1982') &&
    albumListContent.includes('Pop') &&
    albumNameAfterSubmit === '' &&
    releaseYearAfterSubmit === '' &&
    genreAfterSubmit === '' &&
    !favoriteAfterSubmit
  ) {
    console.log('TESTCASE:verify_normal_album_addition_and_reset:success');
  } else {
    console.log('TESTCASE:verify_normal_album_addition_and_reset:failure');
  }

} catch (e) {
  console.log('TESTCASE:verify_normal_album_addition_and_reset:failure');
}
const page8 = await browser.newPage();
try {
  await page8.goto(url);

  await page8.waitForSelector('#albumName', { timeout: 2000 });
  await page8.waitForSelector('#releaseYear', { timeout: 2000 });
  await page8.waitForSelector('#genre', { timeout: 2000 });
  await page8.waitForSelector('#favorite', { timeout: 2000 });
  await page8.waitForSelector('#addAlbumBtn', { timeout: 2000 });
  await page8.waitForSelector('#favoriteAlbumList', { timeout: 2000 });

  await page8.type('#albumName', 'Back in Black');
  await page8.type('#releaseYear', '1980');
  await page8.select('#genre', 'Rock');
  await page8.click('#favorite');
  await page8.click('#addAlbumBtn');

  const favoriteListContent = await page8.$eval('#favoriteAlbumList', el => el.textContent.trim());
  const errorMessage = await page8.$eval('#error-message', el => el.textContent.trim());

  const albumNameAfterSubmit = await page8.$eval('#albumName', el => el.value.trim());
  const releaseYearAfterSubmit = await page8.$eval('#releaseYear', el => el.value.trim());
  const genreAfterSubmit = await page8.$eval('#genre', el => el.value.trim());
  const favoriteAfterSubmit = await page8.$eval('#favorite', el => el.checked);

  if (
    favoriteListContent.includes('Back in Black') &&
    favoriteListContent.includes('1980') &&
    favoriteListContent.includes('Rock') &&
    errorMessage === '' &&
    albumNameAfterSubmit === '' &&
    releaseYearAfterSubmit === '' &&
    genreAfterSubmit === '' &&
    !favoriteAfterSubmit
  ) {
    console.log('TESTCASE:verify_favorite_album_addition_and_reset:success');
  } else {
    console.log('TESTCASE:verify_favorite_album_addition_and_reset:failure');
  }

} catch (e) {
  console.log('TESTCASE:verify_favorite_album_addition_and_reset:failure');
}


  finally {
    await page.close();
    await page1.close();
    await page2.close();
    await page3.close();
    await page4.close();
    await page5.close();
    await page6.close();
    await page7.close();
    await page8.close();
    await browser.close();
  }
})();
