"use client";

import MapImprint from "@/components/map/MapImprint";
import MapDoors from "@/components/map/MapDoors";

/* THE TOP EDGE, as one row.
 *
 * The imprint and the doors were two absolutely-positioned siblings, each with
 * its own hand-set `top` — 10px and 14px on a phone — and nothing that made
 * them agree. That is why the atlas pill sits 9px above the round doors beside
 * it: not a styling slip, two numbers that must match and no rule that they
 * do. The imprint also reserved `right: 104px` for the cluster's width,
 * measured by hand, so changing the doors silently made the reservation wrong.
 *
 * The bottom edge was cured of exactly this by deriving the stack. Here the
 * cure is cheaper, because a row already knows how to align its members: one
 * flex row, `space-between`, and both ends aligned by construction. There is
 * no number left to keep in agreement.
 *
 * The row itself is not a control and does not take the taps that fall between
 * its members — that is map, and the map should still pan there.
 */
export default function MapTop({
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
  return (
    <div className="map-top">
      <MapImprint
        title={title}
        atlasCount={atlasCount}
        pickerOpen={pickerOpen}
        onTogglePicker={onTogglePicker}
      />
      <MapDoors />
    </div>
  );
}
