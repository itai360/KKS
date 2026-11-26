/** Kept apart from editable text, so an edit cannot erase or duplicate the provenance. */
export function CourseOrigin({ course }: { course?: string | null }) {
  return course ? <span className="badge t-gray" title="הועבר למחזור הזה עם מועד הביצוע והמצב המקוריים">נוצר במחזור הקודם: {course}</span> : null;
}
