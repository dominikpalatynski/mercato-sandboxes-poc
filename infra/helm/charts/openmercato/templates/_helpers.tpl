{{- define "openmercato.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "openmercato.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "openmercato.labels" -}}
helm.sh/chart: {{ include "openmercato.chart" . }}
app.kubernetes.io/name: {{ include "openmercato.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "openmercato.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openmercato.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "openmercato.appSecretName" -}}
{{- printf "%s-app" (include "openmercato.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.storageName" -}}
{{- printf "%s-storage" (include "openmercato.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.postgresName" -}}
{{- printf "%s-postgres" (include "openmercato.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.postgresReadWriteName" -}}
{{- printf "%s-rw" (include "openmercato.postgresName" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.postgresSecretName" -}}
{{- printf "%s-auth" (include "openmercato.postgresName" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.redisName" -}}
{{- printf "%s-redis" (include "openmercato.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.redisReadWriteName" -}}
{{- printf "%s-rw" (include "openmercato.redisName" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openmercato.databaseUrl" -}}
{{- printf "postgres://%s:%s@%s.%s.svc.cluster.local:%d/%s?sslmode=disable" .Values.postgres.auth.username .Values.postgres.auth.password (include "openmercato.postgresReadWriteName" .) .Release.Namespace (int .Values.postgres.service.port) .Values.postgres.auth.database -}}
{{- end -}}

{{- define "openmercato.redisUrl" -}}
{{- printf "redis://%s.%s.svc.cluster.local:%d" (include "openmercato.redisReadWriteName" .) .Release.Namespace (int .Values.redis.service.port) -}}
{{- end -}}
