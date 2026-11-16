/**
 * The learning slice's course components. `CourseView` and `PlayerView` are the two views that
 * both the learner routes and the Studio preview mount (spec 6.3: "the real learner course page
 * and player").
 */
export { CourseView, type CourseViewMode, type CourseViewProps } from "./CourseView";
export { PlayerView, type PlayerLiveState, type PlayerViewProps } from "./player/PlayerView";
export { CatalogueView, type CatalogueViewProps } from "./CatalogueView";
export { CourseCard, CourseGrid, categoryName, type CourseCardProps } from "./CourseCard";
export { VideoPlayer, type VideoPlayerProps } from "./VideoPlayer";
export { isPreview, type PlayerMode } from "./types";
