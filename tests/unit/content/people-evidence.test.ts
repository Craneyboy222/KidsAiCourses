import { describe, expect, it } from "vitest";

import { collectText } from "@/content/course-utils";
import {
  findRealPeopleRequirements,
  requiresRealPeopleMedia,
  splitSentences,
} from "@/content/people-evidence";

import { readJson, snapchatCourse } from "./helpers";

/** Sentences that ask for, or invite, images or video of real people. Each must be flagged. */
const MUST_FLAG: string[] = [
  "Upload a selfie with your filter applied.",
  "Take a photo of yourself and upload it.",
  "Film yourself explaining how the app works.",
  "Record yourself on camera presenting your app.",
  "Submit a photo of you and your friend using the app.",
  "Add a screenshot of your face with the filter on.",
  "Upload a short video of your family trying the game.",
  "Ask a friend to pose for the photo, then upload it.",
  "Show your face in the first five seconds.",
  "Get your classmates on camera reacting to the reveal.",
  "Upload a video with you in it.",
  "Use a real photo of someone you know as the test image.",
  "Record a video of people in your street.",
  "Evidence: a photo of a real person wearing your design.",
  "Present your pitch on camera and submit the video.",
  "You could add a photo of your friends if you like.",
  "Upload your profile picture so we can see who made it.",
  "Ask your sister to model the hoodie and take a picture.",
  "Submit a screenshot that shows your face and the filter.",
  "Make a deepfake of your teacher saying something funny.",
  "Record a piece to camera about what you learned.",
  "Send us a headshot for the credits page.",
  "Your video must show real people using the app.",
  // Phrasings likely in other courses: portfolios, adverts, lookbooks, datasets.
  "Add your photo to the About page of your portfolio.",
  "Include a picture of yourself on your CV.",
  "Shoot a 30-second advert starring you and a friend.",
  "Get a mate to wear the hoodie and photograph them.",
  "Film your little brother playing the game.",
  "Upload a clip of your teacher's reaction on camera.",
  "Screenshots should include your face in the camera preview.",
  "Take a selfie, apply the filter and screenshot it.",
  "Use your webcam to record yourself reading the script.",
  "Your end card should show you waving at the camera.",
  "Collect ten photos of your classmates' faces to train the model.",
  "Train the model on images of you smiling and frowning.",
  "Add real photos of people you know to the lookbook.",
  "Interview a family member on video.",
  "A talking-head video explaining your idea.",
  "Submit a vlog of your week.",
  "Photograph a friend holding the product.",
  "Hold up your design and take a mirror selfie.",
  "Record your voice and your face for the avatar.",
  "Upload a picture of someone wearing your design.",
  "Video call a friend and screenshot the call.",
  "Take a picture with your friends and upload it.",
  "Evidence: screenshot plus a short clip of you playing your game.",
  "Upload two photos: one of your design and one of you wearing it.",
  "Ask three friends to try it and video their reactions.",
  "Include photos of your family in the slideshow.",
  "Scan your face to make a 3D avatar and submit the file.",
  "Use a picture of your favourite footballer as the thumbnail.",
  "Clone a celebrity's face onto your video.",
  "Put your face on the poster.",
  "Post a video of yourself doing the challenge.",
  "The advert should feature you or a friend as the presenter.",
  "Take pictures of people at school for your dataset.",
  "Record a short clip showing your friends playing.",
  "Capture your reaction on webcam.",
  "Please attach a photograph of the person you interviewed.",
  "Snap a pic of yourself in the hoodie.",
  "Selfie time: screenshot yourself with the dog-ears filter.",
  "Hand in a 20-second clip of yourself demoing the bot.",
  "Your screenshot needs to show a real face with the sticker tracking it.",
  "Get your mum to try it and film her.",
  "Add a team photo to the About page.",
  "Lookbook: three photos of friends modelling the drop.",
  "Use your own face as the test image.",
  "Turn on your webcam and screenshot yourself with each filter.",
  "Include a short video introducing yourself.",
  "Photograph five people for your dataset.",
  "Record your friend singing the chorus on video.",
  "Make an avatar from a photo of you.",
  "Create a face swap of two friends.",
  "Share a screen recording with your face in the corner.",
  // Negation that does not actually rule the media out.
  "Don't forget to upload a selfie.",
  "No cartoon avatars, only photos of yourself.",
  "Do not upload anything but a selfie.",
  "Do not submit without a selfie.",
  "Remove the background and upload a photo of yourself.",
  "Not sure what to send? A selfie is fine.",
  "Do not use the sample image — upload a photo of yourself.",
  "Upload a selfie (not a cartoon).",
  "When you upload a selfie, make sure the lighting is good.",
];

/** Safe instructions, prohibitions and look-alikes. None may be flagged. */
const MUST_PASS: string[] = [
  // Every real-people phrasing used in the Snapchat-style course and in spec Sections 3.4, 6 and 15.
  "For screenshots, show your filter applied to the provided sample image, a cartoon avatar or an object — not a photo of a real person — and the disappearing chat.",
  "Do not upload images or video of real people.",
  "No real names or photos of real people in your demo or in what you submit as evidence — test filters on the provided sample image, a cartoon avatar, or an object",
  "Face-tracking sticker on the provided sample image or cartoon avatar (do not submit a photo of a real person)",
  "A 'Use sample image' button that loads the provided sample image so filters can be tested and screenshotted without a real person in shot",
  "You submit a private project link, plus screenshots of your filter applied to a provided sample image, cartoon avatar or object (not a photo of a real person), and of the disappearing chat.",
  "Test your filters on the sample image, a cartoon avatar or an object — that is what you will screenshot later.",
  "Add a 'Use sample image' button that loads the provided sample image (download it from this step) in place of the camera.",
  "We made it for this course so you can test and screenshot your filters with nobody in shot.",
  "It is an illustration, not a photo of a real person.",
  "private project link + screenshots of the filter on a provided sample image, cartoon avatar or object, and of the chat (no photos of real people)",
  "A video file that does not contain real people, plus an end-card screenshot that likewise does not show real people.",
  "Constraints: no real-person likeness; rights-cleared audio.",
  "No real messaging between real users",
  // Other prohibitions.
  "Selfies will be rejected.",
  "Photos of real people are not allowed.",
  "Never film yourself or your friends for this project.",
  "Do not upload photos, videos, or recordings of yourself.",
  "If a real person is in shot, crop them out before you upload.",
  "Use a cartoon avatar instead of a selfie.",
  "Avoid using any real photos of people.",
  "You do not need to upload a selfie.",
  "Keep everyone out of shot: no faces, no selfies, no photos of friends.",
  // Look-alikes that are not media of a person.
  "Submit a picture of a cartoon person you drew.",
  "Upload a screenshot of your app showing the filter on the provided sample image.",
  "Take a screenshot of your friend's high score table.",
  "In camera.js, request the camera only after the user taps a clearly labelled button.",
  "Camera only starts after a clear permission prompt",
  "Sends disappearing messages to AI 'friends' in a pretend chat.",
  "Keep the chat between you and the pretend characters only.",
  "We talk about why disappearing messages aren't really gone, how filters affect body image, and why apps should ask before using a camera.",
  "Screenshots of the filters you designed, on the sample image.",
  "Chat screen with 2 AI friends",
  "Copy the share link that a parent or teacher could open if you invited them — not a public listing.",
  "Flag any instruction that would send photos off-device.",
  "Add a selfie-camera button that switches to the sample image.",
  // Safe copy likely in other courses.
  "Your CV must not include a photo of yourself.",
  "Unlisted or view link, or a video file that does not contain real people, plus an end-card screenshot (no real people).",
  "Mock-ups use illustrated models only — never photos of real people.",
  "Train the model on photos of objects such as mugs and pens, not people.",
  "Point the camera at an object, not at yourself or anyone else.",
  "Screenshot the confusion matrix and your results table.",
  "Record a voice-over; keep the camera on your screen, not on you.",
  "Use the provided sample portrait illustration.",
  "Take a picture of your sketchbook page.",
  "A photo of your paper prototype is fine.",
  "Upload an audio file or a private share link.",
  "Before/after screenshots of your prompts.",
  "Explain how deepfakes of politicians spread.",
  "Do not generate fakes of real people.",
  "No personal contact details in public exports.",
  "Write three questions you would ask a friend about the app.",
  "Ask a friend to test the game and tell you what confused them.",
  "Show a parent the privacy screen.",
  "Present your idea to your family and note their feedback.",
  "Why might someone not want their face in an app?",
  "How do filters change how people see their own face?",
  "Never share a photo of someone without asking them.",
  "The camera preview shows whatever the webcam sees, so load the sample image first.",
  "Choose a model in the tool's settings.",
  "People in the UK watch a lot of short video.",
  "Screenshot the leaderboard showing the top three players.",
  "Crop the screenshot so only your app is in frame.",
  "If you appear in the camera preview, switch to the sample image before you take the screenshot.",
  "Check nobody is in the background before you screenshot.",
  "Make sure there are no people in the background.",
  "Record your screen while you play the level.",
  "Take a screenshot of the chat with your two AI friends.",
  "Evidence: a screenshot plus a short clip of your game being played.",
  "Upload two photos: one of your design and one of the packaging.",
  "Ask three friends to try it and write down their reactions.",
  "Use an illustrated mascot, never a real person's face.",
  "The thumbnail must be your own drawing, not a picture of a footballer.",
  "Your poster must not include faces of real people.",
  "Screenshot the dog-ears filter on the cartoon avatar.",
  "Describe your target customer: who are they and what do they need?",
  "List three people who could give you feedback.",
  "Image set: logo, three mock-ups and a lookbook page.",
  "Short report: what your model got right and wrong, with screenshots of the results.",
  "A private share link to your notes.",
  "Export the video and copy the unlisted link.",
  "Make sure your video has a 'Made with AI' end card.",
  "Use rights-cleared audio only.",
  "Who is in charge of what the AI writes? You are.",
  "Remember: other people cannot see your private project.",
  "Add alt text to every image so everyone can use your site.",
  "Friends and family can view your portfolio only if you invite them.",
  "Check the photo permissions screen shows a clear message.",
  "A picture is worth a thousand words; pick images you made yourself.",
  "Tell a friend about your project.",
  "Recording yourself is not needed for this course.",
  "We never ask for photos or videos of you.",
  "Leave people out of your photos.",
  "Faces are not needed: test on the sample image.",
  "Hand in a 20-second screen recording of the bot answering.",
  "Your screenshot needs to show the sticker tracking the sample image.",
  "Get your mum to try it and note what she says.",
  "Add a team name to the About page.",
  "Lookbook: three mock-ups of the drop on illustrated models.",
  "Use the sample image as the test image, not your own face.",
  "Turn on the 'Use sample image' button and screenshot each filter.",
  "Upload a picture of your circuit.",
  "Include a short written introduction.",
  "Photograph five objects for your dataset.",
  "Record the chorus as an audio file.",
  "Make an avatar in the cartoon avatar builder.",
  "No face swaps of real people.",
  "Share a screen recording with the webcam switched off.",
  "Give each AI friend a name and a personality.",
  "What should your app do if someone presses Block?",
  "Put a 'Made with AI' label in the corner of every image.",
  "Team up with a friend if you like, but each of you submits your own link.",
  "Images of real people must never be uploaded.",
  "Stick to objects, pets or drawings for your training images.",
];

describe("people-evidence analyser", () => {
  it("has at least 12 positive and 12 negative cases", () => {
    expect(MUST_FLAG.length).toBeGreaterThanOrEqual(12);
    expect(MUST_PASS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(MUST_FLAG)("flags: %s", (sentence) => {
    expect(requiresRealPeopleMedia(sentence)).toBe(true);
  });

  it.each(MUST_PASS)("passes: %s", (sentence) => {
    expect(findRealPeopleRequirements(sentence)).toEqual([]);
  });

  it("returns the offending sentence and phrase, not the whole text", () => {
    const text =
      "Paste your private project link. Then take a photo of yourself holding your phone! Do not include real names.";
    expect(findRealPeopleRequirements(text)).toEqual([
      { sentence: "Then take a photo of yourself holding your phone!", phrase: "photo of yourself" },
    ]);
  });

  it("works sentence by sentence: a ban in one sentence does not excuse a request in the next", () => {
    const findings = findRealPeopleRequirements(
      "Do not upload videos of real people. Upload a selfie instead.",
    );
    expect(findings.map((finding) => finding.sentence)).toEqual(["Upload a selfie instead."]);
  });

  it("reports each offending sentence once", () => {
    const findings = findRealPeopleRequirements(
      "Film yourself and your friends, then upload a selfie.\n- Add a photo of your family",
    );
    expect(findings.map((finding) => finding.sentence)).toEqual([
      "Film yourself and your friends, then upload a selfie.",
      "- Add a photo of your family",
    ]);
  });

  it("reads through Markdown emphasis and curly quotes", () => {
    expect(requiresRealPeopleMedia("Upload a **photo of yourself**.")).toBe(true);
    expect(requiresRealPeopleMedia("Don’t upload a photo of yourself.")).toBe(false);
  });

  it("handles empty text", () => {
    expect(findRealPeopleRequirements("")).toEqual([]);
    expect(findRealPeopleRequirements("   \n ")).toEqual([]);
  });

  it("splits sentences on full stops, question marks, exclamation marks and line breaks", () => {
    expect(splitSentences("One. Two? Three!\nFour")).toEqual(["One.", "Two?", "Three!", "Four"]);
  });

  it("passes every piece of text in the Snapchat-style course as written", () => {
    const flagged = collectText(snapchatCourse()).flatMap((entry) =>
      findRealPeopleRequirements(entry.text).map((finding) => `${entry.path}: ${finding.sentence}`),
    );
    expect(flagged).toEqual([]);
  });

  it("covers the sentences in the Snapchat course that talk about real people", () => {
    const sentences = collectText(snapchatCourse())
      .flatMap((entry) => splitSentences(entry.text))
      .filter((sentence) => /real (?:person|people)/i.test(sentence));
    expect(sentences.length).toBeGreaterThanOrEqual(5);
    for (const sentence of sentences) expect(findRealPeopleRequirements(sentence)).toEqual([]);
  });

  it("fails an obviously bad brief", () => {
    const brief = [
      "Build a filter app and show it off.",
      "Deliverables: a selfie with each of your three filters, and a video of your friends trying the app.",
      "Film yourself explaining the code.",
    ].join("\n");
    expect(findRealPeopleRequirements(brief)).toHaveLength(2);
  });

  it("flags the one backlog idea that is about photos of real people, and no others", () => {
    const { ideas } = readJson("content/course-ideas.json") as {
      ideas: Array<{ id: string; description: string; title: string }>;
    };
    const flagged = ideas
      .filter((idea) => requiresRealPeopleMedia(`${idea.title}. ${idea.description}`))
      .map((idea) => idea.id);
    expect(flagged).toEqual(["IDEA-054"]);
  });
});
