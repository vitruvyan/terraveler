"use client";

import { useEffect } from "react";
import Icon from "@/components/Icon";

/* THE IMPRINT — whose chart this is, and that there are others.
 *
 * The first of the three classes of map chrome. It is not a control, so it has
 * no container: ink straight onto the map. The one control inside it is the
 * atlas door, and a door is one dark material all the way through — it was a
 * dark emblem with bare text beside it once, and that half read as a caption
 * under the wordmark wherever the door was put.
 *
 * Shared because it was identical in both experiences down to the JSX, and
 * identical is how it stayed only by luck: the Space copy had already lost the
 * comments that explain why each piece is shaped the way it is, which is the
 * first move of every divergence this repo has paid for.
 */
export default function MapImprint({
  title,
  atlasCount,
  pickerOpen,
  onTogglePicker,
}: {
  title: string;
  atlasCount?: number;
  pickerOpen: boolean;
  onTogglePicker: () => void;
}) {
  /* Opening the atlas hides the welcome cartouche, and closing it brings the
     cartouche back — it is not dismissed, because opening a panel is not the
     same as having read the welcome. An event is less coupling than lifting
     state through the page for one boolean.

     This lives with the door rather than in each experience because only the
     Earth map ever dispatched it: on a Voyager or a Moon voyage the welcome
     sat there underneath an open Atlas panel. The contract belongs to the
     control that changes the state, so that it cannot be forgotten again. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("tv:atlas", { detail: pickerOpen }));
  }, [pickerOpen]);

  return (
    <div className="map-imprint">
      <a className="wordmark map-wordmark" href="/" aria-label="Terraveler home">
        Terraveler
      </a>
      {/* What you are looking at. A caption, not part of the door — it was
          inside the button, which made half the control naked text on the map
          and left the whole thing reading as a subtitle under the wordmark
          however it was positioned. */}
      <span className="map-here">{title}</span>

      {/* The door. All of it one dark pill, so there is no half of it that
          could be mistaken for a caption. */}
      <button
        className="map-atlas-door"
        onClick={onTogglePicker}
        aria-expanded={pickerOpen}
        title="Open the Atlas"
      >
        <Icon name="globe" size={17} />
        {/* Split so a narrow phone can drop the word and keep the number.
            Below 400px the labelled pill and the two round doors cannot share
            a row — measured, not assumed: 100px of room for a control that
            wants 131. A globe beside a count still says what it is. */}
        <span>
          {atlasCount ? (
            <>
              {atlasCount}
              <span className="map-door-word"> voyages</span>
            </>
          ) : (
            "The Atlas"
          )}
        </span>
      </button>
    </div>
  );
}
