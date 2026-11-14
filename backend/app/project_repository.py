from uuid import uuid4
from .database import Database, iso

class ProjectRepository:
    def __init__(self, database: Database):
        self.database = database

    @staticmethod
    def public(row):
        return {key: row[key] for key in row.keys() if key != 'user_id'}

    def create(self, user_id: str, title: str, source_text: str) -> dict:
        project_id, now = str(uuid4()), iso()
        with self.database.connect() as connection:
            connection.execute(
                'INSERT INTO projects (project_id,user_id,title,source_text,created_at,updated_at) VALUES (?,?,?,?,?,?)',
                (project_id,user_id,title,source_text,now,now))
            return self.public(connection.execute('SELECT * FROM projects WHERE project_id = ?', (project_id,)).fetchone())

    def get_owned(self, user_id: str, project_id: str) -> dict | None:
        with self.database.connect() as connection:
            row = connection.execute('SELECT * FROM projects WHERE project_id = ? AND user_id = ?', (project_id,user_id)).fetchone()
            return self.public(row) if row else None
